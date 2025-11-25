import os
import json
import time
from dataclasses import dataclass
from typing import List, Dict, Any, Optional, Sequence
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

FORCE_FALLBACK = os.environ.get('ENGINE_FALLBACK', '0') == '1'

try:
    import numpy as np
except Exception:  # pragma: no cover - optional dependency
    np = None  # type: ignore

if not FORCE_FALLBACK:
    try:
        from sentence_transformers import SentenceTransformer

        HAS_ST = True
    except Exception:
        HAS_ST = False
    try:
        import requests
    except Exception:  # pragma: no cover - optional dependency
        requests = None  # type: ignore
else:
    HAS_ST = False
    requests = None  # type: ignore

try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity
    HAS_TFIDF = True
except Exception:
    HAS_TFIDF = False


class SearchResponse(BaseModel):
    query: str
    results: List[Dict[str, Any]]


@dataclass
class AnnConfig:
    provider: str
    url: Optional[str]
    api_key: Optional[str]
    collection: str
    namespace: Optional[str]
    tenant: Optional[str]
    table: Optional[str]
    pg_connection: Optional[str]


def load_ann_config() -> Optional[AnnConfig]:
    provider = os.environ.get('ANN_PROVIDER', '').lower()
    if not provider:
        return None
    return AnnConfig(
        provider=provider,
        url=os.environ.get('ANN_URL'),
        api_key=os.environ.get('ANN_API_KEY'),
        collection=os.environ.get('ANN_COLLECTION', 'code_chunks'),
        namespace=os.environ.get('ANN_NAMESPACE'),
        tenant=os.environ.get('ANN_TENANT'),
        table=os.environ.get('PGVECTOR_TABLE'),
        pg_connection=os.environ.get('PGVECTOR_CONNECTION'),
    )


def load_entries(data_dir: str):
    path = os.path.join(data_dir, 'semantic_entries.json')
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def parse_metadata_filter(raw: Optional[str]) -> Dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def matches_filters(entry: Dict[str, Any], namespace: Optional[str], tenant: Optional[str], metadata_filter: Dict[str, Any]):
    if namespace and entry.get('namespace') not in (None, namespace):
        return False
    if tenant and entry.get('tenant') not in (None, tenant):
        return False
    meta = entry.get('metadata') or {}
    for key, value in metadata_filter.items():
        if meta.get(key) != value:
            return False
    return True


def filter_entries(entries: List[Dict[str, Any]], namespace: Optional[str], tenant: Optional[str], metadata_filter: Dict[str, Any]):
    return [e for e in entries if matches_filters(e, namespace, tenant, metadata_filter)]


def encode_with_retry(model: 'SentenceTransformer', texts: Sequence[str], batch_size: int = 8, max_attempts: int = 3):
    backoff = 0.5
    attempt = 0
    while attempt < max_attempts:
        try:
            return model.encode(
                list(texts),
                batch_size=batch_size,
                show_progress_bar=False,
                convert_to_numpy=True,
            )
        except Exception:
            attempt += 1
            if attempt >= max_attempts:
                raise
            time.sleep(backoff)
            backoff *= 2
    raise RuntimeError('encoding failed after retries')


def cosine_score(vec_a: Sequence[float], vec_b: Sequence[float]) -> float:
    if np is None:
        # Basic manual cosine for environments without numpy
        dot = sum(a * b for a, b in zip(vec_a, vec_b))
        norm_a = sum(a * a for a in vec_a) ** 0.5 or 1.0
        norm_b = sum(b * b for b in vec_b) ** 0.5 or 1.0
        return float(dot / (norm_a * norm_b))
    a = np.array(vec_a)
    b = np.array(vec_b)
    denom = (np.linalg.norm(a) * np.linalg.norm(b)) or 1.0
    return float(np.dot(a, b) / denom)


class AnnStoreAdapter:
    def __init__(self, config: AnnConfig, data_dir: str):
        self.config = config
        self.data_dir = data_dir
        self.local_path = os.path.join(data_dir, f"{config.collection}.ann.json")

    def _persist_local(self, records: List[Dict[str, Any]]):
        try:
            os.makedirs(os.path.dirname(self.local_path), exist_ok=True)
            existing = []
            if os.path.exists(self.local_path):
                with open(self.local_path, 'r', encoding='utf-8') as f:
                    existing = json.load(f)
            merged = {r['id']: r for r in existing}
            for rec in records:
                merged[rec['id']] = rec
            with open(self.local_path, 'w', encoding='utf-8') as f:
                json.dump(list(merged.values()), f, indent=2)
        except Exception:
            pass

    def _http_post(self, url: str, payload: Dict[str, Any], headers: Dict[str, str]) -> bool:
        try:
            if requests:
                requests.post(url, json=payload, headers=headers, timeout=10)
                return True
            from urllib import request as urlrequest

            req = urlrequest.Request(url, data=json.dumps(payload).encode('utf-8'), headers=headers)
            with urlrequest.urlopen(req, timeout=10):
                return True
        except Exception:
            return False
        return False

    def upsert(self, entries: List[Dict[str, Any]], embeddings: Sequence[Sequence[float]]):
        records = []
        for entry, vector in zip(entries, embeddings):
            meta_payload = entry.get('metadata') or {}
            record = {
                'id': entry.get('id') or f"{entry.get('file')}:{entry.get('symbol')}",
                'vector': list(map(float, vector)),
                'payload': {
                    'file': entry.get('file'),
                    'symbol': entry.get('symbol'),
                    'startLine': entry.get('startLine'),
                    'endLine': entry.get('endLine'),
                    'namespace': entry.get('namespace') or self.config.namespace,
                    'tenant': entry.get('tenant') or self.config.tenant,
                    'metadata': {**meta_payload, 'snippet': (entry.get('text') or '')[:200]},
                },
            }
            records.append(record)

        if self.config.provider == 'qdrant' and self.config.url:
            ok = self._http_post(
                f"{self.config.url}/collections/{self.config.collection}/points?wait=true",
                {'points': records},
                {
                    'content-type': 'application/json',
                    **({'api-key': self.config.api_key} if self.config.api_key else {}),
                },
            )
            if ok:
                self._persist_local(records)
                return

        if self.config.provider == 'weaviate' and self.config.url:
            ok = self._http_post(
                f"{self.config.url}/v1/batch/objects",
                {'objects': [
                    {
                        'class': self.config.collection,
                        'id': rec['id'],
                        'properties': rec['payload'],
                        'vector': rec['vector'],
                    }
                    for rec in records
                ]},
                {
                    'content-type': 'application/json',
                    **({'authorization': f"Bearer {self.config.api_key}"} if self.config.api_key else {}),
                },
            )
            if ok:
                self._persist_local(records)
                return

        if self.config.provider == 'pgvector':
            # Without a direct driver we still persist locally for debugging
            self._persist_local(records)
            return

        if self.config.provider in {'file', ''}:
            self._persist_local(records)
            return

        # Default: always persist locally as a safety net
        self._persist_local(records)

    def query(self, vector: Sequence[float], top_k: int, namespace: Optional[str], tenant: Optional[str], metadata_filter: Dict[str, Any]):
        if not os.path.exists(self.local_path):
            return []
        try:
            with open(self.local_path, 'r', encoding='utf-8') as f:
                records = json.load(f)
        except Exception:
            return []

        filtered = []
        for rec in records:
            payload = rec.get('payload', {})
            if namespace and payload.get('namespace') not in (None, namespace):
                continue
            if tenant and payload.get('tenant') not in (None, tenant):
                continue
            meta = payload.get('metadata') or {}
            if any(meta.get(k) != v for k, v in metadata_filter.items()):
                continue
            filtered.append(rec)

        scored = []
        for rec in filtered:
            rec_vector = rec.get('vector') or []
            score = cosine_score(vector, rec_vector) if rec_vector else 0.0
            scored.append((rec, score))
        scored.sort(key=lambda t: t[1], reverse=True)
        return scored[: top_k]


def build_response(records: List[Any]):
    results = []
    for rec, score in records:
        payload = rec.get('payload', {})
        results.append({
            'file': payload.get('file'),
            'symbol': payload.get('symbol'),
            'startLine': payload.get('startLine'),
            'endLine': payload.get('endLine'),
            'score': float(score),
            'snippet': (payload.get('metadata') or {}).get('snippet', '')[:200]
            if isinstance((payload.get('metadata') or {}).get('snippet', ''), str)
            else '',
        })
    return results


def create_app():
    data_dir = os.environ.get('DATA_DIR', './data')
    entries = load_entries(data_dir)
    ann_config = load_ann_config()
    app = FastAPI()

    model: Optional['SentenceTransformer'] = None
    entry_embeddings: Optional[Sequence[Sequence[float]]] = None
    ann_adapter: Optional[AnnStoreAdapter] = None

    if HAS_ST:
        device = os.environ.get('MODEL_DEVICE') or os.environ.get('ENGINE_DEVICE')
        model_name = os.environ.get('EMBEDDING_MODEL', 'sentence-transformers/all-MiniLM-L6-v2')
        model = SentenceTransformer(model_name, device=device if device else None)
        batch_size = int(os.environ.get('EMBED_BATCH_SIZE', '8'))
        entry_embeddings = encode_with_retry(model, [e.get('text', '') for e in entries], batch_size=batch_size)
        if ann_config:
            ann_adapter = AnnStoreAdapter(ann_config, data_dir)
            ann_adapter.upsert(entries, entry_embeddings)

    if not HAS_TFIDF and not model:
        raise RuntimeError('No embedding backend available')

    vectorizer = None
    tfidf_matrix = None
    if not model and HAS_TFIDF:
        corpus = [e['text'] for e in entries]
        vectorizer = TfidfVectorizer()
        tfidf_matrix = vectorizer.fit_transform(corpus)

    @app.get('/search', response_model=SearchResponse)
    def search(q: str, top_k: int = 5, namespace: Optional[str] = None, tenant: Optional[str] = None, metadata: Optional[str] = None):
        meta_filter = parse_metadata_filter(metadata)
        filtered_entries = filter_entries(entries, namespace, tenant, meta_filter)
        if not filtered_entries:
            return {'query': q, 'results': []}

        if model and entry_embeddings is not None:
            filtered_vectors = [vec for ent, vec in zip(entries, entry_embeddings) if ent in filtered_entries]
            try:
                query_vec = encode_with_retry(model, [q], batch_size=1)[0]
            except Exception:
                query_vec = None

            if ann_adapter and query_vec is not None:
                ann_results = ann_adapter.query(list(map(float, query_vec)), top_k, namespace, tenant, meta_filter)
                if ann_results:
                    return {'query': q, 'results': build_response(ann_results)}

            if query_vec is None:
                return {'query': q, 'results': []}

            scored = []
            for entry, vec in zip(filtered_entries, filtered_vectors):
                score = cosine_score(query_vec, vec)
                scored.append((entry, score))
            scored.sort(key=lambda t: t[1], reverse=True)
            out = []
            for entry, score in scored[:top_k]:
                out.append({
                    'file': entry['file'],
                    'symbol': entry['symbol'],
                    'startLine': entry['startLine'],
                    'endLine': entry['endLine'],
                    'score': float(score),
                    'snippet': entry.get('text', '')[:200],
                })
            return {'query': q, 'results': out}

        if vectorizer is not None and tfidf_matrix is not None:
            qv = vectorizer.transform([q])
            sims = cosine_similarity(qv, tfidf_matrix)[0]
            scored = []
            for idx, entry in enumerate(entries):
                if entry not in filtered_entries:
                    continue
                scored.append((entry, float(sims[idx])))
            scored.sort(key=lambda t: t[1], reverse=True)
            out = []
            for entry, score in scored[:top_k]:
                out.append({
                    'file': entry['file'],
                    'symbol': entry['symbol'],
                    'startLine': entry['startLine'],
                    'endLine': entry['endLine'],
                    'score': score,
                    'snippet': entry['text'][:200],
                })
            return {'query': q, 'results': out}

        return {'query': q, 'results': []}

    @app.get('/health')
    def health():
        return {'ok': True}

    @app.get('/summarize')
    def summarize(file: str):
        items = [e for e in entries if e['file'] == file]
        if not items:
            raise HTTPException(404, 'file not found')
        return {'file': file, 'symbols': [e['symbol'] for e in items], 'count': len(items)}

    return app


app = create_app()

if __name__ == '__main__':
    import uvicorn

    host = os.environ.get('ENGINE_HOST', '127.0.0.1')
    port = int(os.environ.get('ENGINE_PORT', '8000'))
    uvicorn.run(app, host=host, port=port)

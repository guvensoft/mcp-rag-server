import os
import json
from typing import List, Dict, Any
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

FORCE_FALLBACK = os.environ.get('ENGINE_FALLBACK', '0') == '1'
if not FORCE_FALLBACK:
    try:
        from sentence_transformers import SentenceTransformer
        import numpy as np
        HAS_ST = True
    except Exception:
        HAS_ST = False
        from sklearn.feature_extraction.text import TfidfVectorizer
        from sklearn.metrics.pairwise import cosine_similarity

    try:
        import chromadb
        from chromadb.config import Settings
        HAS_CHROMA = True
    except Exception:
        HAS_CHROMA = False
else:
    HAS_ST = False
    HAS_CHROMA = False
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity


class SearchResponse(BaseModel):
    query: str
    results: List[Dict[str, Any]]


def load_entries(data_dir: str):
    path = os.path.join(data_dir, 'semantic_entries.json')
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def build_chroma(entries: List[Dict[str, Any]]):
    client = chromadb.Client(Settings(anonymized_telemetry=False))
    coll = client.get_or_create_collection('code_chunks')
    if coll.count() == 0:
        ids = [e['id'] for e in entries]
        metadatas = [{k: e[k] for k in ['file', 'symbol', 'startLine', 'endLine']} for e in entries]
        documents = [e['text'] for e in entries]
        coll.add(ids=ids, metadatas=metadatas, documents=documents)
    return coll


def create_app():
    data_dir = os.environ.get('DATA_DIR', './data')
    entries = load_entries(data_dir)
    app = FastAPI()

    if HAS_ST and HAS_CHROMA:
        # Sentence-Transformers + Chroma
        model = SentenceTransformer(os.environ.get('EMBEDDING_MODEL', 'sentence-transformers/all-MiniLM-L6-v2'))
        coll = build_chroma(entries)

        @app.get('/search', response_model=SearchResponse)
        def search(q: str, top_k: int = 5):
            query_emb = model.encode([q])[0].tolist()
            res = coll.query(query_embeddings=[query_emb], n_results=top_k)
            out = []
            for i in range(len(res['ids'][0])):
                meta = res['metadatas'][0][i]
                doc = res['documents'][0][i]
                dist = res['distances'][0][i]
                # Convert distance to a normalized similarity score in [0,1]
                if dist is None:
                    sim = 0.0
                else:
                    # Assume cosine distance (1 - cosine_similarity). Map to similarity and clamp.
                    sim = 1.0 - float(dist)
                    if sim < 0.0:
                        sim = 0.0
                    if sim > 1.0:
                        sim = 1.0
                out.append({
                    'file': meta.get('file'),
                    'symbol': meta.get('symbol'),
                    'startLine': meta.get('startLine'),
                    'endLine': meta.get('endLine'),
                    'score': sim,
                    'snippet': doc[:200] if isinstance(doc, str) else ''
                })
            return {'query': q, 'results': out}
    else:
        # TF-IDF fallback (in-memory)
        corpus = [e['text'] for e in entries]
        vectorizer = TfidfVectorizer()
        X = vectorizer.fit_transform(corpus)

        @app.get('/search', response_model=SearchResponse)
        def search(q: str, top_k: int = 5):
            qv = vectorizer.transform([q])
            sims = cosine_similarity(qv, X)[0]
            idxs = sims.argsort()[::-1][:top_k]
            out = []
            for i in idxs:
                e = entries[int(i)]
                out.append({
                    'file': e['file'],
                    'symbol': e['symbol'],
                    'startLine': e['startLine'],
                    'endLine': e['endLine'],
                    'score': float(sims[i]),
                    'snippet': e['text'][:200],
                })
            return {'query': q, 'results': out}

    @app.get('/health')
    def health():
        return {'ok': True}

    @app.get('/summarize')
    def summarize(file: str):
        items = [e for e in entries if e['file'] == file]
        if not items:
            raise HTTPException(404, 'file not found')
        # naive summary
        return {'file': file, 'symbols': [e['symbol'] for e in items], 'count': len(items)}

    return app


app = create_app()

if __name__ == '__main__':
    import uvicorn
    host = os.environ.get('ENGINE_HOST', '127.0.0.1')
    port = int(os.environ.get('ENGINE_PORT', '8000'))
    uvicorn.run(app, host=host, port=port)

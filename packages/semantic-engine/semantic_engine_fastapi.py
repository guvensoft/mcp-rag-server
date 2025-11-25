import os
import json
from typing import List, Dict, Any
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel


def load_config():
  explicit = os.environ.get('RAG_CONFIG_PATH')
  search_paths = [p for p in [
    explicit,
    os.path.join(os.getcwd(), 'config', 'rag_config.json'),
    os.path.join(os.path.dirname(__file__), '..', 'config', 'rag_config.json'),
  ] if p]
  for p in search_paths:
    try:
      with open(p, 'r', encoding='utf-8') as f:
        return json.load(f)
    except Exception:
      continue
  return {}


CONFIG = load_config()

FORCE_FALLBACK = os.environ.get('ENGINE_FALLBACK', '0') == '1'
RERANKER_FLAG = os.environ.get('RERANKER_ENABLED')
RERANKER_ENABLED = (RERANKER_FLAG == '1') if RERANKER_FLAG is not None else bool(CONFIG.get('reranker', {}).get('enabled', False))
RERANKER_MODEL = os.environ.get('RERANKER_MODEL', CONFIG.get('reranker', {}).get('model', 'cross-encoder/ms-marco-MiniLM-L-6-v2'))

HAS_RERANKER = False
reranker_model = None
if RERANKER_ENABLED and not FORCE_FALLBACK:
  try:
    from sentence_transformers import CrossEncoder
    reranker_model = CrossEncoder(RERANKER_MODEL)
    HAS_RERANKER = True
  except Exception:
    HAS_RERANKER = False

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


class RerankCandidate(BaseModel):
  text: str
  metadata: Dict[str, Any] = {}


class RerankRequest(BaseModel):
  query: str
  top_k: int = 5
  candidates: List[RerankCandidate]


class RerankResponse(BaseModel):
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

  @app.post('/rerank', response_model=RerankResponse)
  def rerank(body: RerankRequest):
    candidates = body.candidates
    if not candidates:
      return {'results': []}
    if RERANKER_ENABLED and HAS_RERANKER:
      pairs = [[body.query, c.text] for c in candidates]
      scores = reranker_model.predict(pairs)
      scored = [
        {
          'score': float(score),
          'text': c.text,
          'metadata': c.metadata
        }
        for score, c in zip(scores, candidates)
      ]
    else:
      tokens = body.query.lower().split()
      scored = []
      for c in candidates:
        text_lower = c.text.lower()
        hits = sum(1 for t in tokens if t in text_lower)
        score = float(hits / len(tokens)) if tokens else 0.0
        scored.append({'score': score, 'text': c.text, 'metadata': c.metadata})
    scored.sort(key=lambda x: x['score'], reverse=True)
    return {'results': scored[: body.top_k]}

  @app.get('/health')
  def health():
    return {'ok': True, 'reranker': RERANKER_ENABLED and HAS_RERANKER}

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

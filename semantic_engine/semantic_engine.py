"""
Minimal semantic engine implemented in Python. The engine loads a
precomputed set of code snippets (semantic entries) from a JSON file and
calculates simple bag‑of‑words embeddings for each snippet. It exposes an
HTTP API to perform approximate semantic searches over these snippets. A
cosine similarity metric is used to rank results. This module is meant
to mirror the architecture described in the MCP plan, albeit in a
simplified form.
"""

import json
import math
import os
import re
import sys
from collections import Counter
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse


class SemanticEngine:
    def __init__(self, data_dir: str) -> None:
        # Load entries from semantic_entries.json
        entries_path = os.path.join(data_dir, 'semantic_entries.json')
        with open(entries_path, 'r', encoding='utf-8') as f:
            self.entries = json.load(f)
        # Build vocabulary and compute TF vectors
        self.vocabulary = set()
        self.entry_vectors = []
        for entry in self.entries:
            tokens = self.tokenize(entry['text'])
            self.vocabulary.update(tokens)
        self.vocabulary = sorted(self.vocabulary)
        vocab_index = {t: i for i, t in enumerate(self.vocabulary)}
        for entry in self.entries:
            vec = self.vectorize(entry['text'], vocab_index)
            self.entry_vectors.append(vec)

    @staticmethod
    def tokenize(text: str):
        """Split text into lower‑case tokens. In addition to splitting on
        non‑word characters we also break up camelCase identifiers into
        separate words. For example, "createOrder" becomes ["create", "order"]."""
        # Introduce spaces before capital letters preceded by a lowercase letter or digit
        text = re.sub(r'([a-z0-9])([A-Z])', r'\1 \2', text)
        # Split on non‑word characters and lowercase
        tokens = [t.lower() for t in re.split(r'\W+', text) if t]
        return tokens

    def vectorize(self, text: str, vocab_index: dict):
        tokens = self.tokenize(text)
        counts = Counter(tokens)
        vec = [0.0] * len(vocab_index)
        for t, c in counts.items():
            if t in vocab_index:
                vec[vocab_index[t]] = float(c)
        # Normalize to unit length
        norm = math.sqrt(sum(x * x for x in vec))
        if norm > 0:
            vec = [x / norm for x in vec]
        return vec

    def search(self, query: str, top_k: int = 5):
        # Vectorize query
        vocab_index = {t: i for i, t in enumerate(self.vocabulary)}
        query_vec = self.vectorize(query, vocab_index)
        results = []
        for entry, vec in zip(self.entries, self.entry_vectors):
            # Compute cosine similarity (dot product since vectors are normalized)
            score = sum(a * b for a, b in zip(query_vec, vec))
            if score > 0:
                results.append((score, entry))
        # Sort descending by score
        results.sort(key=lambda x: x[0], reverse=True)
        # Prepare response list of dicts
        output = []
        for score, entry in results[:top_k]:
            output.append(
                {
                    'file': entry['file'],
                    'symbol': entry['symbol'],
                    'startLine': entry['startLine'],
                    'endLine': entry['endLine'],
                    'score': score,
                    'snippet': entry['text'][:200],
                }
            )
        return output


class RequestHandler(BaseHTTPRequestHandler):
    engine: SemanticEngine = None  # type: ignore

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/search':
            params = parse_qs(parsed.query)
            query = params.get('q', [''])[0]
            top_k_str = params.get('top_k', ['5'])[0]
            try:
                top_k = int(top_k_str)
            except ValueError:
                top_k = 5
            results = self.engine.search(query, top_k)
            body = json.dumps({'query': query, 'results': results}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()


def run_server(data_dir: str, host: str = 'localhost', port: int = 8000):
    engine = SemanticEngine(data_dir)
    RequestHandler.engine = engine
    server = HTTPServer((host, port), RequestHandler)
    print(f'Semantic engine listening on {host}:{port}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('Shutting down')
        server.server_close()


if __name__ == '__main__':
    # Data directory expected as first argument or environment variable
    if len(sys.argv) > 1:
        data_dir = sys.argv[1]
    else:
        data_dir = os.environ.get('DATA_DIR', './data')
    host = os.environ.get('ENGINE_HOST', 'localhost')
    port_str = os.environ.get('ENGINE_PORT', '8000')
    try:
        port = int(port_str)
    except ValueError:
        port = 8000
    run_server(data_dir, host=host, port=port)
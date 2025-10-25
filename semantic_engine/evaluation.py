import math
from collections import Counter
from typing import Iterable, List, Dict


def _tokenize(text: str) -> List[str]:
    return [token for token in text.lower().split() if token]


def _ngrams(tokens: List[str], n: int) -> Counter:
    return Counter(tuple(tokens[i : i + n]) for i in range(len(tokens) - n + 1))


def bleu_score(reference: str, candidate: str, max_n: int = 4) -> float:
    ref_tokens = _tokenize(reference)
    cand_tokens = _tokenize(candidate)
    if not cand_tokens:
        return 0.0
    precisions: List[float] = []
    for n in range(1, max_n + 1):
        ref_ngrams = _ngrams(ref_tokens, n)
        cand_ngrams = _ngrams(cand_tokens, n)
        if not cand_ngrams:
            precisions.append(1e-9)
            continue
        overlap = sum((cand_ngrams & ref_ngrams).values())
        precisions.append((overlap + 1e-9) / (sum(cand_ngrams.values()) + 1e-9))
    geo_mean = math.exp(sum(math.log(p) for p in precisions) / max_n)
    brevity = math.exp(min(0.0, 1.0 - len(ref_tokens) / (len(cand_tokens) + 1e-9)))
    return geo_mean * brevity


def rouge_l_score(reference: str, candidate: str) -> float:
    ref_tokens = _tokenize(reference)
    cand_tokens = _tokenize(candidate)
    if not ref_tokens or not cand_tokens:
        return 0.0

    m, n = len(ref_tokens), len(cand_tokens)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(m - 1, -1, -1):
        for j in range(n - 1, -1, -1):
            if ref_tokens[i] == cand_tokens[j]:
                dp[i][j] = 1 + dp[i + 1][j + 1]
            else:
                dp[i][j] = max(dp[i + 1][j], dp[i][j + 1])
    lcs = dp[0][0]
    recall = lcs / m
    precision = lcs / n
    if recall + precision == 0:
        return 0.0
    beta_sq = precision * precision / (recall * recall + 1e-9)
    return ((1 + beta_sq) * recall * precision) / (precision + beta_sq * recall + 1e-9)


def cosine_similarity_score(reference: str, candidate: str) -> float:
    ref_tokens = Counter(_tokenize(reference))
    cand_tokens = Counter(_tokenize(candidate))
    if not ref_tokens or not cand_tokens:
        return 0.0
    intersection = set(ref_tokens) & set(cand_tokens)
    dot = sum(ref_tokens[t] * cand_tokens[t] for t in intersection)
    ref_norm = math.sqrt(sum(v * v for v in ref_tokens.values()))
    cand_norm = math.sqrt(sum(v * v for v in cand_tokens.values()))
    if ref_norm == 0 or cand_norm == 0:
        return 0.0
    return dot / (ref_norm * cand_norm)


def evaluate(pairs: Iterable[Dict[str, str]]) -> Dict[str, float]:
    total_bleu = 0.0
    total_rouge = 0.0
    total_cosine = 0.0
    count = 0
    for pair in pairs:
        reference = pair.get("reference", "")
        candidate = pair.get("candidate", "")
        total_bleu += bleu_score(reference, candidate)
        total_rouge += rouge_l_score(reference, candidate)
        total_cosine += cosine_similarity_score(reference, candidate)
        count += 1
    if count == 0:
        return {"bleu": 0.0, "rouge_l": 0.0, "cosine": 0.0}
    return {
        "bleu": total_bleu / count,
        "rouge_l": total_rouge / count,
        "cosine": total_cosine / count,
    }

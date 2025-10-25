from semantic_engine import evaluation


def test_bleu_non_zero_for_overlap():
    ref = "return a plus b"
    cand = "return a plus b"
    score = evaluation.bleu_score(ref, cand)
    assert score > 0.9


def test_rouge_and_cosine_scores():
    ref = "export function add numbers"
    cand = "function add numbers together"
    rouge = evaluation.rouge_l_score(ref, cand)
    cosine = evaluation.cosine_similarity_score(ref, cand)
    assert 0 < rouge <= 1
    assert 0 < cosine <= 1


def test_dataset_evaluation():
    pairs = [
        {"reference": "return value", "candidate": "return value"},
        {"reference": "compute sum", "candidate": "sum numbers"},
    ]
    metrics = evaluation.evaluate(pairs)
    assert set(metrics.keys()) == {"bleu", "rouge_l", "cosine"}
    assert metrics["bleu"] > 0

"""
Word-embedding based line matching for chord merging.
Uses GloVe embeddings for semantic similarity.
"""
import re
import numpy as np

# Global model cache
_model = None

def get_model():
    """Load GloVe model (cached)."""
    global _model
    if _model is None:
        import gensim.downloader as api
        import warnings
        warnings.filterwarnings('ignore')
        _model = api.load('glove-wiki-gigaword-50')
    return _model

def tokenize(text: str) -> list[str]:
    """Simple word tokenizer."""
    # Lowercase, remove punctuation, split
    text = text.lower()
    text = re.sub(r'[^\w\s]', '', text)
    return text.split()

def word_sequence_similarity(words1: list[str], words2: list[str]) -> float:
    """
    Compute semantic similarity between two word sequences.
    For each word in seq1, find best matching word in seq2.
    Returns mean of best matches.
    """
    model = get_model()
    scores = []
    
    for w1 in words1:
        if w1 not in model:
            continue
        best = 0
        for w2 in words2:
            if w2 not in model:
                continue
            sim = model.similarity(w1, w2)
            if sim > best:
                best = sim
        if best > 0:
            scores.append(best)
    
    return np.mean(scores) if scores else 0

def embedding_match_score(text1: str, text2: str) -> float:
    """Compute embedding-based similarity between two text strings."""
    words1 = tokenize(text1)
    words2 = tokenize(text2)

    if not words1 or not words2:
        return 0.0

    # Bidirectional: average of both directions
    score1 = word_sequence_similarity(words1, words2)
    score2 = word_sequence_similarity(words2, words1)

    # Convert to native Python float (not numpy float32)
    return float((score1 + score2) / 2)


if __name__ == '__main__':
    # Test
    pairs = [
        ("the quick brown fox", "the fast tan dog"),
        ("walking down the road", "strolling along the path"),
        ("hello world", "goodbye universe"),
    ]
    
    print("Embedding similarity tests:")
    for t1, t2 in pairs:
        score = embedding_match_score(t1, t2)
        print(f"  {score:.2f}: '{t1}' vs '{t2}'")

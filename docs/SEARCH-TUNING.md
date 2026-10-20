# Search tuning — similarity threshold

Measured against the real corpus in `vector_store/translation_embeddings.db`
(DDIA 2nd ed., 1,115 chunks, 768-dim `nomic-embed-text`) using **real user
queries** embedded with the live model.

## The number: 0.60

For 12 on-topic and 10 off-topic queries against this single English book:

```
on-topic  best-chunk similarity:  0.636 … 0.815
off-topic best-chunk similarity:  0.415 … 0.576
                                   ^^^^^^^^^  the gap is [0.58, 0.64]
```

Chunks passing each threshold, per query (out of 1,115):

| threshold | on-topic: min / median | off-topic: max | verdict |
|---|---|---|---|
| 0.45 | 34 / 535 | 151 | noise floods in |
| 0.50 | 9 / 224 | 11 | off-topic still matches |
| 0.52 | 2 / 137 | 3 | off-topic still matches |
| 0.55 | 1 / 72 | 1 | borderline |
| 0.58 | 1 / 32 | **0** | safe, tight margin |
| **0.60** | **1 / 28** | **0** | **chosen — safe both ways** |
| 0.62 | 1 / 17 | 0 | safe, tighter to the on-topic floor |
| 0.65 | **0** / 10 | 0 | too strict — weakest on-topic query returns nothing |

**0.60** is the middle of the gap: every on-topic query returns at least one
result, and no off-topic query returns any.

## Why the old 0.3 was wrong

Two random chunks of the same book already score **0.578** — one English
technical book is a very homogeneous corpus, so the noise floor is high.
A threshold of 0.3 sat far below it and filtered nothing: results were just
"top 5 by similarity", however weak.

## A note on how this was calibrated

An earlier version of this document calibrated the threshold by using each
**chunk's own embedding as a pseudo-query**. That distribution is wrong: a
chunk's own embedding scores ~0.83 against itself, whereas a real query
peaks at ~0.64–0.82. Calibrating against pseudo-queries produced a threshold
of 0.75, which is *above* the real on-topic band and made legitimate
searches return "No results found".

**Always calibrate with real queries**, embedded by the real model.

## Corpus dependence

The threshold is specific to this corpus. It shifts with:

- **Corpus homogeneity** — many unrelated documents push the floor *down*, so
  lower the threshold (0.45–0.5). One homogeneous book pushes it *up*.
- **Language** — cross-language similarity drops sharply; a mixed
  English/Arabic corpus needs a lower threshold than a single English one.
- **Embedding model** — a different model has a different similarity scale.
  Re-measure after changing `OLLAMA_EMBEDDING_MODEL`.

## Setting it

```bash
export VECTOR_SIMILARITY_THRESHOLD=0.60
```

The value is read from the environment at import time; there is no `.env`
loader (see `.env.example` and the README).

## A more robust alternative

An absolute threshold is fragile across corpora. A relative rule adapts
automatically: keep the top-k by similarity, then keep only those within a
margin of the best hit (e.g. `similarity >= 0.9 * top_similarity`). That
removes near-duplicate hits without a fixed number. Not implemented yet — the
absolute threshold is the current behaviour.

## Reproducing the measurement

```python
import json, numpy as np, requests
from src.vector_store import VectorStore

s = VectorStore()
conn = s._connect()
rows = conn.execute('SELECT embedding FROM embeddings').fetchall()
conn.close()
M = np.asarray([json.loads(r[0]) for r in rows], dtype=np.float32)
M /= np.linalg.norm(M, axis=1, keepdims=True)

def embed(text):
    r = requests.post('http://<ollama>:11434/api/embed',
                      json={'model': 'nomic-embed-text', 'input': text}, timeout=60)
    return r.json()['embeddings'][0]

e = np.asarray(embed('how does leader election work in a replicated log'), dtype=np.float32)
e /= np.linalg.norm(e)
sims = M @ e
print(sims.max(), (sims >= 0.60).sum())
```

"""Generate fresh parity inputs with the supplied, unchanged Python reference.

This does not assign music grades: stars below are synthetic arithmetic fixtures.
Run before Vitest (npm pretest). The output is disposable build/test data.
"""
import json
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "docs/reference-supplement"))
from nmc_reference_v019 import (
    GLOBAL, SOURCE_PRESETS, DIMENSIONS, PolicyError,
    base_vector, adjusted_weights, score_album,
)

out = []
for genre_id in GLOBAL:
    for preset in SOURCE_PRESETS:
        for na in [[], ["lyrics"], ["performance"], ["lyrics", "performance"]]:
            item = {"gid": genre_id, "preset": preset, "na": na}
            try:
                weights = adjusted_weights(base_vector(genre_id), source_preset=preset, na_dims=na)
                stars = dict(zip(DIMENSIONS, [4.5, 4, 4, 3.5, 4, 4.5]))
                for dimension in na:
                    stars[dimension] = None
                result = score_album(stars, weights, na)
                exact = str(result["score_numerator"])
                if result["score_denominator"] != 1:
                    exact += "/" + str(result["score_denominator"])
                item.update(ok=True, weights=list(map(str, weights)), score=result["score_display"], exact=exact)
            except PolicyError:
                item["ok"] = False
            out.append(item)

target = root / "node_modules/.cache/nmc-reference-matrix.json"
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
print(f"Python reference: generated {len(out)} cases ({sum(case['ok'] for case in out)} valid) → {target.relative_to(root)}")

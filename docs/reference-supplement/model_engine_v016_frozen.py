"""NMC 0.16 reference: source-adjusted album-level 6D score.
Not an objective measure; scores/rubric require separate editorial justification.
"""
import json
from fractions import Fraction
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

FIELDS=('lyrics','composition','performance','sound','vision','context')
DYNAMIC=FIELDS[:4]
PRESETS=json.loads((Path(__file__).parent/'source-correction-policy-v0.16.json').read_text(encoding='utf-8'))['presets']

class Invalid(Exception): pass

def _as_fraction(x):
    return x if isinstance(x,Fraction) else Fraction(str(x))

def weight_vector(weights):
    if len(weights)!=6: raise Invalid('six weights required')
    v=tuple(_as_fraction(x) for x in weights)
    if sum(v)!=100 or sum(v[:4])!=70 or v[4:]!=(15,15):
        raise Invalid('base weight invariant failed')
    if min(v[:4])<0: raise Invalid('negative weight')
    return v

def validate_delta(delta, max_l1):
    if len(delta)!=6: raise Invalid('six-element delta required')
    d=tuple(_as_fraction(x) for x in delta)
    if any(x.denominator!=1 for x in d) or d[4:]!=(0,0) or sum(d)!=0 or sum(abs(x) for x in d)>max_l1:
        raise Invalid('invalid zero-sum or budget or fixed-dim delta')
    return d

def corrected_weights(base, source_preset='none', cultural_delta=(0,0,0,0,0,0), lyrics_na=False, source_override=None):
    base=weight_vector(base)
    if source_preset not in PRESETS: raise Invalid('unknown preset')
    if source_override is not None:
        source=validate_delta(source_override,16)
    else:
        source=validate_delta(PRESETS[source_preset],16)
    culture=validate_delta(cultural_delta,4)
    if sum(map(abs,source))+sum(map(abs,culture))>16:
        raise Invalid('combined gross correction exceeds 16')
    # Cultural correction retains V0.13 ordering: apply to raw genre weights first.
    culturally_adjusted=tuple(base[i]+culture[i] for i in range(6))
    if lyrics_na:
        # Re-normalize after cultural correction, BEFORE independent provenance shift.
        # A source delta targeting the absent Lyrics dimension would be double transfer.
        if source[0] or culture[0]: raise Invalid('lyrics N/A cannot transfer lyrics weight')
        original=sum(culturally_adjusted[1:4])
        vec=(Fraction(0), *(culturally_adjusted[i]*70/original for i in range(1,4)), culturally_adjusted[4],culturally_adjusted[5])
    else:
        vec=culturally_adjusted
    vec=tuple(vec[i]+source[i] for i in range(6))
    if any(x < 5 for x in vec[1:4]) or (not lyrics_na and vec[0]<5) or vec[4:]!=(15,15) or sum(vec)!=100:
        raise Invalid('adjusted weight violated limits')
    if sum(vec[:4])!=70: raise Invalid('dynamic total violated')
    return vec

def score(stars, weights):
    if len(stars)!=6 or len(weights)!=6: raise Invalid('six dimensions required')
    total=Fraction(0)
    for s,w in zip(stars,weights):
        if s is None:
            if w!=0: raise Invalid('N/A with nonzero weight')
            continue
        s=_as_fraction(s)
        if not (Fraction(1,2)<=s<=5 and (s*2).denominator==1):
            raise Invalid('star is not 0.5-5 half step')
        total+=_as_fraction(w)*s
    exact=total/50
    display=(Decimal(exact.numerator)/Decimal(exact.denominator)).quantize(Decimal('0.01'),rounding=ROUND_HALF_UP)
    return {'score_exact':exact,'score_display':f'{display:.2f}'}

def weights_dict(v): return {key:float(w) for key,w in zip(FIELDS,v)}

if __name__=='__main__':
    w=corrected_weights((24,23,14,9,15,15), 'existing_dominant_standard')
    print(weights_dict(w), score((4,4,4,4,4,4), w)['score_display'])

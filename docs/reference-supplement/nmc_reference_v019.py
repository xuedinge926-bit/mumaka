"""NMC V0.19-RC1: executable *reference*, not an audio classifier or a review generator.
Requires editor-supplied genre and dimension stars. Strictly separates structural correctness
from publication eligibility. Python stdlib only. 2026-10-29.
"""
from __future__ import annotations
import csv
import hashlib
import json
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from fractions import Fraction
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data'
DIMENSIONS = ('lyrics','composition','performance','sound','vision','context')
DYNAMIC = DIMENSIONS[:4]
REQUIRED_GRADE_EVIDENCE = ('tracks', 'rationale', 'why_not_lower')
SOURCE_PRESETS = json.loads((ROOT/'source-correction-policy-v0.16.json').read_text(encoding='utf-8'))['presets']

class PolicyError(ValueError): pass


def read_rows(filename: str) -> list[dict[str,str]]:
    with (DATA/filename).open(encoding='utf-8-sig', newline='') as f:
        return list(csv.DictReader(f))

GLOBAL = {r['genre_id']:r for r in read_rows('genre-weights-v0.17-frozen.csv')}
INDEX = {r['entry_id']:r for r in read_rows('CHINA_MARKET_INDEX_33.csv')}
REGIONAL = {r['review_id']:r for r in read_rows('REGIONAL_FOLK_DECISION_REGISTER.csv')}
BASE_SHA256 = hashlib.sha256((DATA/'genre-weights-v0.17-frozen.csv').read_bytes()).hexdigest()
VERSION = 'V0.19-RC1'


def frac(v: Any) -> Fraction:
    return v if isinstance(v, Fraction) else Fraction(str(v))


def base_vector(genre_id: str) -> tuple[Fraction,...]:
    if genre_id not in GLOBAL: raise PolicyError('unknown genre ID: '+str(genre_id))
    row=GLOBAL[genre_id]
    out=tuple(frac(row[k]) for k in DIMENSIONS)
    if len(out)!=6 or sum(out)!=100 or sum(out[:4])!=70 or out[4:]!=(15,15):
        raise PolicyError('invalid genre weight vector')
    return out


def resolve_index(entry_id:str, *, album_audio_checked=False, structural_evidence='', historic_tradition_evidence='') -> dict:
    if entry_id in REGIONAL: raise PolicyError('regional folk terms are review candidates/tags, not active independent genre IDs')
    if entry_id not in INDEX: raise PolicyError('unknown China-market index entry; choose explicit global genre or a known index entry')
    r=INDEX[entry_id]
    if r['usage_state']=='conditional' and not (album_audio_checked and len(structural_evidence.strip())>=20):
        raise PolicyError('conditional style requires album audio and documented audible structural evidence')
    if r['entry_type']=='recognized_historical_alias' and not (album_audio_checked and len(structural_evidence.strip())>=12 and len(historic_tradition_evidence.strip())>=12):
        raise PolicyError('campus-folk historical alias requires both musical and historical tradition evidence')
    return {'entry_id':entry_id,'genre_id':r['global_genre_id'],
            'entry_type':r['entry_type'],'status':r['usage_state'],
            'weights':base_vector(r['global_genre_id'])}


def blend_weights(track_selections:list[dict], method:str, *, cross_family_reason:str) -> tuple[Fraction,...]:
    """Album-level genre-weight blending, NOT averaging per-track star scores.
    Must choose method equal_tracks or duration; every track explicitly assigned a base global genre.
    """
    if not cross_family_reason or len(cross_family_reason.strip())<20:
        raise PolicyError('documented cross-family need required')
    if method not in ('equal_tracks','duration') or not track_selections:
        raise PolicyError('unknown method or empty track list')
    w=[]
    for t in track_selections:
        if not t.get('genre_evidence') or len(str(t['genre_evidence']).strip())<8:
            raise PolicyError('each track needs evidence for its genre')
        amount=1 if method=='equal_tracks' else t.get('duration_seconds')
        if amount is None or frac(amount)<=0: raise PolicyError('missing or invalid track duration')
        w.append(frac(amount))
    total=sum(w)
    mixed=tuple(sum(base_vector(t['genre_id'])[i]*w[j] for j,t in enumerate(track_selections))/total for i in range(6))
    if sum(mixed)!=100 or mixed[4:]!=(15,15): raise PolicyError('blend invariants failed')
    return mixed


def validate_delta(delta, limit: int) -> tuple[Fraction,...]:
    if len(delta)!=6: raise PolicyError('six-element correction required')
    d=tuple(frac(x) for x in delta)
    if any(x.denominator!=1 for x in d) or sum(d)!=0 or d[4:]!=(0,0) or sum(abs(x) for x in d)>limit:
        raise PolicyError('invalid correction vector; noninteger, nonzero-sum, fixed-dimension, or over budget')
    return d


def adjusted_weights(base:tuple[Fraction,...], *, source_preset='none', source_override=None, culture_delta=(0,0,0,0,0,0), na_dims=()) -> tuple[Fraction,...]:
    if len(base)!=6 or sum(base)!=100 or sum(base[:4])!=70 or base[4:]!=(15,15):
        raise PolicyError('invalid base weights')
    if source_preset not in SOURCE_PRESETS: raise PolicyError('unknown source preset')
    if source_override is not None and source_preset!='none':
        raise PolicyError('source override and named source preset are mutually exclusive')
    source=validate_delta(source_override if source_override is not None else SOURCE_PRESETS[source_preset],16)
    culture=validate_delta(culture_delta,4)
    if sum(map(abs,source))+sum(map(abs,culture))>16:
        raise PolicyError('combined gross L1 exceeds 16 percentage points')
    na=set(na_dims)
    if na - {'lyrics','performance'}: raise PolicyError('only Lyrics and exceptionally Performance may be N/A')
    for name in na:
        idx=DIMENSIONS.index(name)
        if source[idx] or culture[idx]: raise PolicyError('cannot transfer weight in an N/A dimension')
    # Apply culture on the *original* base, remove N/A and re-normalize dynamic to 70,
    # then source shift among remaining eligible dimensions. Never reallocate absent weight twice.
    cultural=tuple(a+b for a,b in zip(base,culture))
    applicable=[i for i,n in enumerate(DYNAMIC) if n not in na]
    denominator=sum(cultural[i] for i in applicable)
    if denominator<=0: raise PolicyError('no applicable dynamic weight')
    restored=[Fraction(0) if i not in applicable else cultural[i]*70/denominator for i in range(4)]
    final=tuple(restored+[Fraction(15),Fraction(15)])
    final=tuple(a+b for a,b in zip(final,source))
    if sum(final)!=100 or sum(final[:4])!=70 or final[4:]!=(15,15):
        raise PolicyError('final weight invariant failed')
    if any(final[i]<5 for i in applicable) or any(final[DIMENSIONS.index(n)]!=0 for n in na):
        raise PolicyError('weight minima or N/A exclusion failed')
    return final


def score_album(stars:dict, weights:tuple[Fraction,...], na_dims=()) -> dict|None:
    na=set(na_dims)
    if set(stars)!=set(DIMENSIONS): raise PolicyError('need 6 explicit fields, including null for N/A/unassessed')
    total=Fraction(0)
    for i,d in enumerate(DIMENSIONS):
        s=stars[d]
        if d in na:
            if s is not None or weights[i]!=0: raise PolicyError('N/A star must be null and weight 0')
            continue
        if s is None: return None  # Unassessed never silently becomes N/A or zero
        v=frac(s)
        if v<Fraction(1,2) or v>5 or (v*2).denominator!=1:
            raise PolicyError('stars must be half-star steps from 0.5 to 5')
        total+=v*weights[i]
    exact=total/50
    display=(Decimal(exact.numerator)/Decimal(exact.denominator)).quantize(Decimal('0.01'),rounding=ROUND_HALF_UP)
    return {'score_display':str(display),'score_numerator':exact.numerator,'score_denominator':exact.denominator}


def evaluate_review(review:dict) -> dict:
    """Build reproducible snapshot; publication gate is not evidence verification by AI."""
    warnings=[]
    if review.get('blended_track_genres'):
        b=review['blended_track_genres']
        base=blend_weights(b['tracks'],b['method'],cross_family_reason=b.get('cross_family_reason',''))
        style={'global_genre_id':'cross-family-weight-blend','method':b['method']}
    elif review.get('index_entry_id'):
        style=resolve_index(review['index_entry_id'],album_audio_checked=review.get('album_audio_checked',False),
            structural_evidence=review.get('genre_structural_evidence',''),
            historic_tradition_evidence=review.get('historic_tradition_evidence',''))
        base=style['weights']
    else:
        gid=review.get('global_genre_id')
        base=base_vector(gid)
        style={'global_genre_id':gid,'entry_type':'global_main','weights':base}
        if not review.get('genre_structural_evidence'):
            warnings.append('missing genre-specific musical rationale')
    if not review.get('genre_structural_evidence'):
        warnings.append('missing genre-specific musical rationale')
    source=review.get('source_preset','none')
    source_override=review.get('source_override')
    source_nonzero=(source!='none' or source_override is not None and any(frac(x)!=0 for x in source_override))
    culture=review.get('culture_delta',[0]*6)
    nonzero_culture=any(frac(x)!=0 for x in culture)
    if source_nonzero and (review.get('source_audit_status')!='approved_with_track_ledger' or not review.get('track_source_ledger')):
        warnings.append('nonzero source correction lacks approved track-level provenance ledger')
    # Strict V0.13 policy: zero empirically approved numeric cultural profiles.
    # Changing approval text in a review cannot manufacture authorization.
    if nonzero_culture:
        warnings.append('numeric cultural delta blocked: approved profile registry is empty')
    if not review.get('culture_qualitative_review'):
        warnings.append('mandatory qualitative culture review missing')
    na=review.get('na_dims',[])
    if 'performance' in na and not review.get('performance_na_editorial_approval'):
        warnings.append('exceptional Performance N/A not approved')
    if na and not review.get('na_evidence'):
        warnings.append('N/A requires explicit evidence')
    final=adjusted_weights(base,source_preset=source,source_override=source_override,culture_delta=culture,na_dims=na)
    result=score_album(review['stars'],final,na)
    if result is None: warnings.append('unassessed dimension; numeric album score unavailable')
    if not review.get('album_audio_checked'): warnings.append('full-release audio review not attested')
    if not review.get('song_credits_verified'): warnings.append('song-level lyrics/composition provenance not verified')
    if not review.get('release_identity_verified'): warnings.append('release edition/type and tracklist not verified')
    if not review.get('reviewer_id'): warnings.append('responsible reviewer missing')
    if review.get('market_frequency_claim')=='verified':
        warnings.append('market frequency has NOT been empirically established in this package')
    for d in DIMENSIONS:
        s=review['stars'].get(d)
        if s is None: continue
        ev=(review.get('dimension_evidence') or {}).get(d,{})
        if not isinstance(ev,dict) or not str(ev.get('rationale','')).strip():
            warnings.append(f'{d}: independent rating rationale missing')
        if frac(s)>=Fraction(9,2) and (not isinstance(ev,dict) or not all(str(ev.get(k,'')).strip() for k in REQUIRED_GRADE_EVIDENCE)):
            warnings.append(f'{d}: 4.5/5 requires tracks, rationale, and why-not-lower')
    # No version-driven migration; result explicitly carries snapshot and base hash.
    return {
      'model_version':VERSION,'weights_source_sha256':BASE_SHA256,'release_id':review.get('release_id'),
      'style':{k:(str(v) if isinstance(v,Fraction) else v) for k,v in style.items() if k!='weights'},
      'base_weights':[str(x) for x in base], 'final_weights':[str(x) for x in final],
      'score':result,'review_status':'publish_eligible' if not warnings else 'research_candidate',
      'blocking_issues':sorted(set(warnings))
    }

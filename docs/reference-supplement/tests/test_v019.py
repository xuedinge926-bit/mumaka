"""Run: python -m unittest discover -s tests -v (from package root)."""
import csv,copy,hashlib,json,sys,unittest
from decimal import Decimal, ROUND_HALF_UP
from fractions import Fraction
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from nmc_reference_v019 import *

class IndexTests(unittest.TestCase):
 def test_global_database_preserved(self):
  manifest=json.loads((DATA/'VERSION_MANIFEST.json').read_text(encoding='utf-8'))
  self.assertEqual(len(GLOBAL),558)
  self.assertEqual(BASE_SHA256,manifest['global_base_sha256'])
  for gid in GLOBAL:
   b=base_vector(gid)
   self.assertEqual(sum(b),100)
   self.assertEqual(sum(b[:4]),70)
   self.assertEqual(b[4:],(15,15))
 def test_index33_32_base_and_one_alias(self):
  self.assertEqual(len(INDEX),33)
  self.assertEqual(len(set(INDEX)),33)
  self.assertEqual(sum(r['entry_type']=='base_style' for r in INDEX.values()),32)
  self.assertEqual(sum(r['entry_type']=='recognized_historical_alias' for r in INDEX.values()),1)
  self.assertEqual(sum(r['usage_state']=='conditional' for r in INDEX.values()),2)
  self.assertEqual(sum(r['usage_state']=='active_alias' for r in INDEX.values()),1)
  self.assertEqual(len({r['global_genre_id'] for r in INDEX.values()}),32)
  for row in INDEX.values(): self.assertIn(row['global_genre_id'],GLOBAL)
 def test_campus_alias_requires_both_forms_of_evidence(self):
  with self.assertRaises(PolicyError): resolve_index('cn-index:campus-folk')
  with self.assertRaises(PolicyError): resolve_index('cn-index:campus-folk',album_audio_checked=True,structural_evidence='原声吉他结合民谣歌曲表达')
  s=resolve_index('cn-index:campus-folk',album_audio_checked=True,structural_evidence='原声吉他主导，旋律段落与歌唱方式具有稳定歌曲形态',historic_tradition_evidence='研究性说明：能够联系台湾校园民歌与创作传统')
  self.assertEqual(s['genre_id'],'genre:contemporary-folk')
  self.assertEqual(s['weights'],base_vector('genre:contemporary-folk'))
 def test_regional_candidate_is_not_independent_genre(self):
  for ident in ('cn-review:northwest-folk','cn-review:northwest-folk-rock','cn-review:dialect-folk','cn-review:dialect-rock'):
   with self.assertRaises(PolicyError):resolve_index(ident)
  self.assertEqual(REGIONAL['cn-review:northwest-folk-rock']['fallback_global_genre_id'],'genre:folk-rock')
 def test_conditional_chinese_style(self):
  with self.assertRaises(PolicyError):resolve_index('cn-index:chinese-style-pop')
  self.assertEqual(resolve_index('cn-index:chinese-style-pop',album_audio_checked=True,structural_evidence='传统声腔音型与流行编配构成结构性融合且贯穿整张')['genre_id'],'genre:chinese-style-pop')
 def test_ordinary_style_language_independent(self):
  self.assertEqual(resolve_index('cn-index:folk-rock')['weights'],base_vector('genre:folk-rock'))
  self.assertEqual(resolve_index('cn-index:contemporary-folk')['weights'],base_vector('genre:contemporary-folk'))

class CalculationTests(unittest.TestCase):
 def test_558_all_10_half_steps_and_presets(self):
  # Exhaust all 558 genre profiles; legal source presets only.
  stars={'lyrics':4.5,'composition':4,'performance':4,'sound':3.5,'vision':4,'context':4.5}
  for gid in GLOBAL:
   base=base_vector(gid)
   for preset in SOURCE_PRESETS:
    try: w=adjusted_weights(base,source_preset=preset)
    except PolicyError:continue
    res=score_album(stars,w)
    self.assertTrue(0.5<=float(res['score_display'])<=10)
    self.assertEqual(sum(w),100)
    self.assertEqual(sum(w[:4]),70)
    self.assertEqual(w[4:],(15,15))
 def test_score_exact_and_half_up(self):
  w=base_vector('genre:folk-rock')
  s=dict.fromkeys(DIMENSIONS,4)
  self.assertEqual(score_album(s,w)['score_display'],'8.00')
  s['lyrics']=5
  exact=sum(frac(s[k])*weight for k,weight in zip(DIMENSIONS,w))/50
  self.assertEqual(score_album(s,w)['score_display'],str((Decimal(exact.numerator)/Decimal(exact.denominator)).quantize(Decimal('.01'),rounding=ROUND_HALF_UP)))
 def test_lyrics_na(self):
  base=base_vector('genre:post-rock')
  w=adjusted_weights(base,na_dims=['lyrics'])
  self.assertEqual(w[0],0)
  self.assertEqual(sum(w),100)
  stars={'lyrics':None,'composition':4,'performance':4,'sound':4,'vision':4,'context':4}
  self.assertEqual(score_album(stars,w,['lyrics'])['score_display'],'8.00')
  with self.assertRaises(PolicyError): adjusted_weights(base,source_preset='mixed_light',na_dims=['lyrics'])
 def test_performance_na_exceptional(self):
  w=adjusted_weights(base_vector('genre:electropop'),na_dims=['performance'])
  self.assertEqual(w[2],0)
  s=dict.fromkeys(DIMENSIONS,4);s['performance']=None
  self.assertEqual(score_album(s,w,['performance'])['score_display'],'8.00')
 def test_unassessed_not_na(self):
  base=base_vector('genre:pop-general'); s=dict.fromkeys(DIMENSIONS,4);s['lyrics']=None
  self.assertIsNone(score_album(s,base))
 def test_illegal_correction_budget(self):
  base=base_vector('genre:pop-general')
  with self.assertRaises(PolicyError): adjusted_weights(base,source_preset='existing_dominant_exceptional',culture_delta=(1,-1,0,0,0,0))
  with self.assertRaises(PolicyError): adjusted_weights(base,source_preset='mixed_light',culture_delta=(0,0,0,1,0,-1))
  ok=adjusted_weights(base,source_preset='mixed_light',culture_delta=(1,-1,0,0,0,0))
  self.assertEqual(sum(ok),100)
 def test_blend_track_weights_not_track_scores(self):
  ts=[{'genre_id':'genre:pop-general','genre_evidence':'常规流行主导旋律结构','duration_seconds':180},
      {'genre_id':'genre:folk-rock','genre_evidence':'电吉他乐队与叙事民谣结构','duration_seconds':240}]
  out=blend_weights(ts,'duration',cross_family_reason='在同一发行中并无单一主导家族，分别呈现清晰可辨认的跨家族段落')
  self.assertEqual(out[4:],(15,15))
  self.assertEqual(out[0],(base_vector('genre:pop-general')[0]*180+base_vector('genre:folk-rock')[0]*240)/420)
  self.assertEqual(sum(out),100)
 def test_high_grade_evidence_gate(self):
  review={'release_id':'demo','index_entry_id':'cn-index:pop-general','stars':dict.fromkeys(DIMENSIONS,4.5),'album_audio_checked':True,'genre_structural_evidence':'整张歌曲使用常规流行音乐旋律结构与制作形式', 'culture_qualitative_review':'已进行语言文化适配定性审查','song_credits_verified':True,'release_identity_verified':True,'reviewer_id':'human-reviewer', 'dimension_evidence':{d:{'rationale':'具备独立实现证据'} for d in DIMENSIONS}}
  result=evaluate_review(review)
  self.assertEqual(result['review_status'],'research_candidate')
  self.assertTrue(any('why-not-lower' in x for x in result['blocking_issues']))
  for d in DIMENSIONS:review['dimension_evidence'][d].update(tracks='整张作品多首曲目',why_not_lower='跨整碟持续实现，排除4星的证据已记录')
  self.assertEqual(evaluate_review(review)['review_status'],'publish_eligible')
  review['source_preset']='mixed_light'
  self.assertEqual(evaluate_review(review)['review_status'],'research_candidate')
  review['source_audit_status']='approved_with_track_ledger';review['track_source_ledger']=[{'track':'a','lyrics':'existing','composition':'existing'}]
  self.assertEqual(evaluate_review(review)['review_status'],'publish_eligible')
  review['culture_delta']=[1,-1,0,0,0,0]
  review['cultural_profile_approval']='approved'
  self.assertEqual(evaluate_review(review)['review_status'],'research_candidate') # empty registry cannot be self-approved
 def test_no_publishing_unknown_audio(self):
  review={'release_id':'demo','global_genre_id':'genre:folk-rock','stars':dict.fromkeys(DIMENSIONS,4), 'genre_structural_evidence':'持续存在民谣歌曲与摇滚合奏结构'}
  r=evaluate_review(review)
  self.assertEqual(r['review_status'],'research_candidate')
  self.assertGreater(len(r['blocking_issues']),2)
 def test_legacy_33_weight_vectors_not_changed(self):
  with (DATA/'CHINA_MARKET_CORE_32_V018_ARCHIVE.csv').open(encoding='utf-8-sig') as f:
   original=list(csv.DictReader(f))
  for row in original:
   new=INDEX['cn-index:'+row['genre_id'].replace('genre:','')]
   self.assertEqual(new['global_genre_id'],row['genre_id'])
   self.assertEqual(base_vector(new['global_genre_id']),tuple(int(row[k]) for k in DIMENSIONS))

if __name__=='__main__':unittest.main()

class ProvenanceOverrideTests(unittest.TestCase):
 def test_composition_only_source_shift_allowed(self):
  base=base_vector('genre:pop-general')
  w=adjusted_weights(base,source_override=(0,-2,1,1,0,0))
  self.assertEqual(w[0],base[0]);self.assertEqual(w[1],base[1]-2)
  with self.assertRaises(PolicyError):adjusted_weights(base,source_preset='mixed_light',source_override=(0,-2,1,1,0,0))
 def test_source_override_lyrics_na_protects_absent_field(self):
  base=base_vector('genre:post-rock')
  w=adjusted_weights(base,na_dims=['lyrics'],source_override=(0,-2,1,1,0,0))
  self.assertEqual(w[0],0)
  with self.assertRaises(PolicyError): adjusted_weights(base,na_dims=['lyrics'],source_override=(-2,0,1,1,0,0))

import { expect, it } from 'vitest';
import { DIMENSIONS, newAlbum, type Calculation } from '../model/types';
import { toScoreCardData } from './scoreCardData';

it('passes frozen history to a template without recalculating or sharing mutable rating objects',()=>{
  const album=newAlbum();album.title='History';album.summary='Short review';for(const d of DIMENSIONS)album.ratings[d].value=4;
  album.ratings.lyrics.value='na';
  const frozen:Calculation={valid:true,complete:true,total:'6.66',exactTotal:'333/50',baseWeights:[],finalWeights:[],errors:[],warnings:[],eligibilityIssues:[],publishEligible:false};
  const provenance={modelVersion:'V0.17-frozen'};
  const data=toScoreCardData(album,frozen,provenance);
  expect(data.score).toEqual({total:'6.66',exactTotal:'333/50'});expect(data.ratings.lyrics.value).toBe('na');
  expect(data.album.id).toBe(album.id);expect(data.summary).toBe('Short review');
  data.ratings.sound.value=5;expect(album.ratings.sound.value).toBe(4);
  (data.modelProvenance as {modelVersion:string}).modelVersion='changed';expect(provenance.modelVersion).toBe('V0.17-frozen');
});

import { calculatePrivateMath, genres, sourcePresets } from './engine';
import type { Album, Calculation } from './types';

export interface PrivateSourceResolution {
  confirmed: boolean;
  preset: string | null;
  message?: string;
}

/** Descriptions of the existing five presets, not a new threshold classifier. */
export const PRIVATE_SOURCE_PRESET_OPTIONS: readonly Readonly<{value:string;label:string;description:string}>[] = Object.freeze([
  { value:'none', label:'沿用风格原有的侧重', description:'保持原有侧重；适用于新作，或风格已经充分考虑旧作演绎的情形。' },
  { value:'mixed_light', label:'旧材料有实质份额，但不占主体', description:'新旧素材混合，以新材料为主体，既有词曲仍实质参与作品。' },
  { value:'mixed_material', label:'旧材料较多，重新作曲有限', description:'新旧素材混合，既有材料较多，本次重新作曲的份额有限。' },
  { value:'existing_dominant_standard', label:'既有词曲主导，以当下诠释为重', description:'作品主要依赖既有词曲，本次价值重心在演绎与声音实现。' },
  { value:'existing_dominant_exceptional', label:'极高继承依赖，极少新词曲', description:'极高程度沿用既有材料，极少新增词曲的特殊情形。' },
].map(option => Object.freeze(option)));

/** Never infer a source category from Spotify metadata, track counts or reputation. */
export function resolvePrivateSource(album: Album): PrivateSourceResolution {
  // No migration: preserve old vectors and named presets until the user explicitly
  // enters the new source workflow. Custom legacy vectors stay intact as well.
  if (!album.ux || album.ux.sourceKind === undefined) {
    const preset = album.sourcePreset ?? 'none';
    return Object.hasOwn(sourcePresets, preset)
      ? { confirmed:true, preset }
      : { confirmed:false, preset:null, message:'原有来源设置无法识别，请重新确认。' };
  }
  const { sourceKind, sourcePresetConfirmed, sourceDoubleCount } = album.ux;
  if (sourceKind === 'new') return { confirmed:true, preset:'none' };
  if (sourceKind === 'unknown') return { confirmed:false, preset:null, message:'歌曲来源尚未确认，可先保存草稿。' };
  if (!['cover','mixed','rerecord'].includes(sourceKind)) return { confirmed:false, preset:null, message:'请选择歌曲主要来自新创作还是旧作。' };
  if (!sourcePresetConfirmed || !Object.hasOwn(sourcePresets, sourcePresetConfirmed)) return { confirmed:false, preset:null, message:'请选择适合这张专辑的侧重方式。' };
  if (sourceDoubleCount !== 'clear' && sourceDoubleCount !== 'included') return { confirmed:false, preset:null, message:'请确认所选风格是否已经考虑旧作演绎。' };
  if (sourceDoubleCount === 'included' && sourcePresetConfirmed !== 'none') return { confirmed:false, preset:null, message:'风格已经考虑旧作演绎，请选择沿用风格原有的侧重。' };
  return { confirmed:true, preset:sourcePresetConfirmed };
}

/**
 * Private records can be scored and exported without public-review evidence.
 * The shared engine still validates every numeric constraint, exact calculation,
 * N/A exclusion and blend input. Neither source resolution nor review text is fabricated.
 */
export function calculatePrivate(album: Album): Calculation {
  const source = resolvePrivateSource(album);
  const effective: Album = album.ux?.sourceKind !== undefined && source.confirmed
    ? { ...album, sourcePreset:source.preset ?? 'none', sourceDelta:[0,0,0,0,0,0] }
    : album;
  const result = calculatePrivateMath(effective);
  const privateIssue = '私人评分记录；图片导出不代表通过正式发表审核';
  const issues = [...new Set([...result.eligibilityIssues, privateIssue])];
  const warnings = [...result.warnings];
  if (album.blendMode !== 'single') {
    const families = new Set(album.tracks.map(track => genres.find(g => g.id === track.genreId)?.parentId).filter(Boolean));
    if (families.size === 1) warnings.push('所选曲目属于同一家族，可优先选择该家族已有的常规风格。');
  }
  if (!source.confirmed) {
    const message = source.message ?? '歌曲来源尚未确认，可先保存草稿。';
    return { ...result, valid:false, total:null, exactTotal:null, finalWeights:[], finalWeightsExact:[], errors:[...new Set([...result.errors, message])], warnings, eligibilityIssues:[...issues, message], publishEligible:false };
  }
  return { ...result, warnings, eligibilityIssues:issues, publishEligible:false };
}

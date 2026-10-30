import { createId } from '../lib/browserCrypto';
export const DIMENSIONS = ['lyrics','composition','performance','sound','vision','context'] as const;
export type Dimension = typeof DIMENSIONS[number];
export const LABELS: Record<Dimension,string> = { lyrics:'作词',composition:'作曲',performance:'表演',sound:'声音',vision:'愿景',context:'语境' };
export type Weights = [number,number,number,number,number,number];
export interface Genre { id:string; name:string; nameEn:string; status:string; weights:number[]; parentId?:string; note?:string; validation?:string; orientationReason?:string }
export interface ChinaEntry { id:string; name:string; group:string; genreId:string; status:string; kind:string; criteria:string; insufficient:string; verification:string }
export interface Rating { value:number|null|'na'; evidence:string; counterEvidence:string; rationale:string; highJustification:string; notLower:string; naReason:string; naApproved:boolean }
export type ProvenanceKind = 'new'|'existing'|'rerecord'|'unknown';
export interface Track { id:string; title:string; duration:number; genreId:string; genreEvidence?:string; provenanceKind?:ProvenanceKind; lyricsSource:string; compositionSource:string; sourceEvidence:string }
export interface AlbumUX {
 market:'china'|'global';
 sourceKind?:'new'|'cover'|'mixed'|'rerecord'|'unknown';
 sourcePresetConfirmed?:string;
 sourceDoubleCount?:'clear'|'included'|'unknown';
 cardRatio?:'4:5'|'3:4'|'1:1';
 cardTheme?:'paper'|'ink';
}
/** Optional, additive provenance. Old records and frozen snapshots require no migration. */
export interface AlbumImportSource {
 provider:'apple-music'|'bandcamp'; url:string; metadataUrl:string; fetchedAt:string; adapter:string;
 releaseDate:string; releaseType:'album'|'ep'|'single'|null; referenceGenres:string[];
}
export type RecordStatus = 'draft'|'research_candidate'|'publish_eligible'|'published';
export interface Album {
 id:string; title:string; artist:string; year:string; release:string; kind:'专辑'|'EP'; cover:string; language:string; region:string; label:string;
 genreId:string; chinaEntryId:string; genreEvidence:string; genreExclusions:string; historicTraditionEvidence?:string; crossFamilyReason?:string;
 blendMode:'single'|'equal'|'duration'; tracks:Track[];
 cultureNote:string; cultureDelta:Weights; sourceDelta:Weights; sourcePreset?:string; sourceNote:string; sourceReviewed:boolean; noDoubleCount:boolean;
 ratings:Record<Dimension,Rating>; summary:string; reviewer:string; fullListenConfirmed:boolean; releaseIdentityVerified?:boolean;
 status:RecordStatus; createdAt:string; updatedAt:string; revision:number; parentSnapshotId?:string;
 ux?:AlbumUX;
 spotify?:{id:string;url:string;coverUrl?:string;releaseDate?:string};
 importSource?:AlbumImportSource;
}
export interface Calculation { valid:boolean; complete:boolean; total:string|null; exactTotal:string|null; baseWeights:string[]; finalWeights:string[]; baseWeightsExact?:string[]; finalWeightsExact?:string[]; errors:string[]; warnings:string[]; eligibilityIssues:string[]; publishEligible:boolean }
export interface Snapshot { id:string; albumId:string; createdAt:string; reviewer:string; album:Album; calculation:Calculation; provenance:unknown; kind:'saved'|'published' }
export function newAlbum():Album {
 const now=new Date().toISOString();
 const ratings=Object.fromEntries(DIMENSIONS.map(d=>[d,{value:null,evidence:'',counterEvidence:'',rationale:'',highJustification:'',notLower:'',naReason:'',naApproved:false}])) as Album['ratings'];
 return {id:createId(),title:'',artist:'',year:'',release:'',kind:'专辑',cover:'',language:'',region:'',label:'',genreId:'',chinaEntryId:'',genreEvidence:'',genreExclusions:'',blendMode:'single',tracks:[],cultureNote:'',cultureDelta:[0,0,0,0,0,0],sourceDelta:[0,0,0,0,0,0],sourceNote:'',sourceReviewed:false,noDoubleCount:false,ratings,summary:'',reviewer:'',fullListenConfirmed:false,status:'draft',createdAt:now,updatedAt:now,revision:1};
}

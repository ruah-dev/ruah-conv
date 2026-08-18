import type { HttpMethod } from "../ir/schema.js";

export type CuratePreset = "minimal" | "standard" | "full";

export type CurationDecision = "keep" | "drop" | "split";

export interface CurationMember {
	name: string;
	method: HttpMethod;
	path: string;
	operationId?: string;
	action: string;
	score: number;
	estTokens: number;
	deprecated?: boolean;
}

export interface CurationGroup {
	id: string;
	name: string;
	resource: string;
	basePath: string;
	decision: CurationDecision;
	reason: string;
	score: number;
	members: CurationMember[];
}

export interface CurationDropped {
	name: string;
	method: HttpMethod;
	path: string;
	reason: string;
}

export interface CurationEndpointRef {
	name: string;
	method: HttpMethod;
	path: string;
}

export interface CurationDrift {
	added: CurationEndpointRef[];
	removed: CurationEndpointRef[];
}

export interface CurationHeaviest {
	name: string;
	estTokens: number;
}

export interface CurationPlan {
	schemaVersion: "1";
	source: string;
	title: string;
	specVersion: string;
	preset: CuratePreset;
	totalTools: number;
	curatedTools: number;
	definitionTokens: number;
	curatedTokens: number;
	heaviest: CurationHeaviest[];
	groups: CurationGroup[];
	dropped: CurationDropped[];
	drift?: CurationDrift;
	note: string;
}

export interface CurateOptions {
	preset?: CuratePreset;
	limit?: number;
	source?: string;
}

export interface ReplayResult {
	plan: CurationPlan;
	drift: CurationDrift;
}

export const CURATION_NOTE =
	"Heuristic grouping + merge. Every drop has a stated reason. Not LLM-assisted.";

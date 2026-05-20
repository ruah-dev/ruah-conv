// Generator capability descriptor — declares which CLI flags each target honors,
// and whether the target emits a single JSON artifact or a multi-file scaffold.

export type GeneratorEmits = "json" | "files";

export interface GeneratorCapability {
	id: string;
	label: string;
	emits: GeneratorEmits;
	supportsTransport: boolean;
	supportsName: boolean;
}

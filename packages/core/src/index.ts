// Public API — for programmatic use of @ruah-dev/conv

export type {
	GeneratedFile,
	GenerateOptions,
	GenerateResult,
	GeneratorInfo,
} from "./generators/index.js";
// Generation
export { generate, getTargets } from "./generators/index.js";
// IR types
export type {
	AuthSchema,
	HttpMethod,
	IRArray,
	IRComposite,
	IREnum,
	IRObject,
	IRPrimitive,
	IRProperty,
	IRRef,
	IRType,
	IRUnknown,
	PaginationInfo,
	Parameter,
	RequestBody,
	ResponseSchema,
	RuahToolSchema,
	SchemaMeta,
	SourceFormat,
	Tool,
	TypeDefinition,
	ValidationWarning,
	WarningCode,
} from "./ir/schema.js";
// Validation
export { validateIR } from "./ir/validate.js";
// Naming
export {
	deduplicateNames,
	normalizeToolName,
	synthesizeToolName,
} from "./naming/index.js";
// Parsing
export { detectFormat, getSupportedFormats, parse } from "./parsers/index.js";

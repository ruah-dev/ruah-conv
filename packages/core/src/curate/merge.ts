import type {
	HttpMethod,
	IRObject,
	IRProperty,
	IRType,
	Parameter,
	RuahToolSchema,
	Tool,
} from "../ir/schema.js";
import { deduplicateNames } from "../naming/index.js";
import { identityOf } from "./family.js";
import { getPresetPolicy, truncateDescription } from "./presets.js";
import type { CurationGroup, CurationPlan } from "./types.js";

const RISK_RANK: Record<Tool["riskLevel"], number> = {
	safe: 0,
	moderate: 1,
	destructive: 2,
};

/**
 * IR → IR transform. Existing generators consume the result unchanged.
 * Groups marked `keep` with 2+ members become one task tool whose input
 * schema is `{ action, ...fields }`. `split` keeps original operations.
 */
export function applyCurate(
	ir: RuahToolSchema,
	plan: CurationPlan,
): RuahToolSchema {
	const byIdentity = new Map(ir.tools.map((tool) => [identityOf(tool), tool]));
	const tools: Tool[] = [];

	for (const group of plan.groups) {
		if (group.decision === "drop") continue;
		const members = resolveMembers(group, byIdentity);
		if (members.length === 0) continue;

		if (group.decision === "split" || members.length === 1) {
			tools.push(...members);
			continue;
		}

		tools.push(mergeMembers(group, members));
	}

	const names = deduplicateNames(tools.map((tool) => tool.name));
	const maxDescription = getPresetPolicy(plan.preset).maxDescriptionChars;
	const renamed = tools.map((tool, index) => {
		const named =
			names[index] === tool.name
				? tool
				: { ...tool, name: names[index] ?? tool.name };
		const description = truncateDescription(named.description, maxDescription);
		return description === named.description
			? named
			: { ...named, description };
	});

	return {
		...ir,
		tools: renamed,
		meta: {
			...ir.meta,
			description: [
				ir.meta.description,
				`Curated ${ir.tools.length} endpoints → ${renamed.length} task tools (${plan.preset}).`,
			]
				.filter(Boolean)
				.join(" "),
		},
	};
}

function resolveMembers(
	group: CurationGroup,
	byIdentity: Map<string, Tool>,
): Tool[] {
	const resolved: Tool[] = [];
	for (const member of group.members) {
		const tool = byIdentity.get(`${member.method} ${member.path}`);
		if (tool) resolved.push(tool);
	}
	return resolved;
}

function mergeMembers(group: CurationGroup, members: Tool[]): Tool {
	const actionValues = group.members
		.filter((member) =>
			members.some(
				(tool) => tool.method === member.method && tool.path === member.path,
			),
		)
		.map((member) => member.action);

	const properties: Record<string, IRProperty> = {
		action: {
			type: {
				kind: "enum",
				values: actionValues,
				description: `One of: ${actionValues.join(", ")}`,
			},
			description: "Which operation to run on this resource",
		},
	};

	for (const member of members) {
		const planMember = group.members.find(
			(item) => item.method === member.method && item.path === member.path,
		);
		const action = planMember?.action ?? member.method.toLowerCase();
		addParameters(properties, member.parameters, action);
		addBodyFields(properties, member, action);
	}

	const riskLevel = members.reduce<Tool["riskLevel"]>((highest, tool) => {
		return RISK_RANK[tool.riskLevel] > RISK_RANK[highest]
			? tool.riskLevel
			: highest;
	}, "safe");

	const tags = unique(members.flatMap((tool) => tool.tags ?? []));
	const auth = unique(members.flatMap((tool) => tool.auth ?? []));
	const actionsList = actionValues.join(", ");

	const tool: Tool = {
		name: group.name,
		description: [
			`Manage ${group.resource} (${actionsList}).`,
			...members.map(
				(member) =>
					`${member.method} ${member.path}: ${member.description || member.name}`,
			),
		].join(" "),
		method: primaryMethod(members),
		path: group.basePath,
		parameters: [],
		requestBody: {
			required: true,
			contentType: "application/json",
			description: `Discriminated by action (${actionsList}). Supply the fields that action needs.`,
			schema: {
				kind: "object",
				required: ["action"],
				properties,
				additionalProperties: false,
				description: `Task tool for ${group.resource}`,
			} satisfies IRObject,
		},
		responses: [
			{
				statusCode: "200",
				description: "Result of the selected action",
			},
		],
		idempotent: members.every((member) => member.idempotent),
		readOnly: members.every((member) => member.readOnly),
		riskLevel,
	};

	if (tags.length > 0) tool.tags = tags;
	if (auth.length > 0) tool.auth = auth;
	return tool;
}

function primaryMethod(members: Tool[]): HttpMethod {
	if (members.some((member) => member.method === "POST")) return "POST";
	if (members.some((member) => member.method === "PUT")) return "PUT";
	if (members.some((member) => member.method === "PATCH")) return "PATCH";
	return members[0]?.method ?? "POST";
}

function addParameters(
	properties: Record<string, IRProperty>,
	parameters: Parameter[],
	action: string,
): void {
	for (const param of parameters) {
		if (param.in === "header" || param.in === "cookie") continue;
		const description = [
			param.description,
			`Used by action "${action}" (${param.in}${param.required || param.in === "path" ? ", required" : ""}).`,
		]
			.filter(Boolean)
			.join(" ");
		mergeProperty(properties, param.name, param.schema, description);
	}
}

function addBodyFields(
	properties: Record<string, IRProperty>,
	tool: Tool,
	action: string,
): void {
	const body = tool.requestBody;
	if (!body) return;
	const schema = body.schema;
	if (schema.kind === "object") {
		for (const [name, prop] of Object.entries(schema.properties)) {
			const description = [
				prop.description,
				`Used by action "${action}" (body).`,
			]
				.filter(Boolean)
				.join(" ");
			mergeProperty(properties, name, prop.type, description);
		}
		return;
	}
	mergeProperty(
		properties,
		"body",
		schema,
		`Request body for action "${action}".`,
	);
}

function mergeProperty(
	properties: Record<string, IRProperty>,
	name: string,
	type: IRType,
	description: string,
): void {
	const existing = properties[name];
	if (!existing) {
		properties[name] = { type, description };
		return;
	}
	const prior = existing.description ? `${existing.description} ` : "";
	existing.description = `${prior}${description}`.trim();
}

function unique(values: string[]): string[] {
	return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

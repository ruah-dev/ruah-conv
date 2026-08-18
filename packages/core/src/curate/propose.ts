import type { RuahToolSchema, Tool } from "../ir/schema.js";
import { estimateDefinitionTokens } from "./estimator.js";
import {
	actionFor,
	familyFromPath,
	taskToolName,
	uniquifyActions,
} from "./family.js";
import { getPresetPolicy } from "./presets.js";
import { buildTagFrequency, scoreTool, toolDefinitionTokens } from "./score.js";
import type {
	CurateOptions,
	CurationDropped,
	CurationGroup,
	CurationMember,
	CurationPlan,
} from "./types.js";
import { CURATION_NOTE } from "./types.js";

export function proposeCurate(
	ir: RuahToolSchema,
	options: CurateOptions = {},
): CurationPlan {
	const preset = options.preset ?? "standard";
	const policy = getPresetPolicy(preset);
	const maxGroups = options.limit ?? policy.maxGroups;
	const tagFrequency = buildTagFrequency(ir.tools);

	const buckets = new Map<string, { familyId: string; tools: Tool[] }>();
	const dropped: CurationDropped[] = [];

	for (const tool of ir.tools) {
		if (tool.deprecated && !policy.includeDeprecated) {
			dropped.push({
				name: tool.name,
				method: tool.method,
				path: tool.path,
				reason: "deprecated",
			});
			continue;
		}
		if (policy.methods && !policy.methods.has(tool.method)) {
			dropped.push({
				name: tool.name,
				method: tool.method,
				path: tool.path,
				reason: `preset-${preset}-method`,
			});
			continue;
		}

		const family = familyFromPath(tool.path);
		if (family.depth > policy.maxDepth) {
			dropped.push({
				name: tool.name,
				method: tool.method,
				path: tool.path,
				reason: "deep-nesting",
			});
			continue;
		}

		const bucket = buckets.get(family.id);
		if (bucket) {
			bucket.tools.push(tool);
		} else {
			buckets.set(family.id, { familyId: family.id, tools: [tool] });
		}
	}

	const groups: CurationGroup[] = [];
	for (const bucket of [...buckets.values()].sort((a, b) =>
		a.familyId.localeCompare(b.familyId),
	)) {
		const family = familyFromPath(bucket.tools[0]?.path ?? "/");
		const rawActions = bucket.tools.map((tool) =>
			actionFor(tool.method, tool.path),
		);
		const actions = uniquifyActions(rawActions);
		const members: CurationMember[] = bucket.tools
			.map((tool, index) => {
				const member: CurationMember = {
					name: tool.name,
					method: tool.method,
					path: tool.path,
					action: actions[index] ?? actionFor(tool.method, tool.path),
					score: scoreTool(tool, tagFrequency),
					estTokens: toolDefinitionTokens(tool),
				};
				if (tool.operationId) member.operationId = tool.operationId;
				if (tool.deprecated) member.deprecated = true;
				return member;
			})
			.sort(
				(a, b) =>
					b.score - a.score ||
					a.method.localeCompare(b.method) ||
					a.path.localeCompare(b.path),
			);

		const score = members.reduce((sum, member) => sum + member.score, 0);
		groups.push({
			id: family.id,
			name: taskToolName(family.resource, family.version),
			resource: family.resource,
			basePath: family.basePath,
			decision: "keep",
			reason: "top-level-resource",
			score,
			members,
		});
	}

	groups.sort(
		(a, b) =>
			b.score - a.score ||
			a.name.localeCompare(b.name) ||
			a.id.localeCompare(b.id),
	);

	const kept: CurationGroup[] = [];
	for (const group of groups) {
		if (kept.length < maxGroups) {
			kept.push(group);
		} else {
			const over: CurationGroup = {
				...group,
				decision: "drop",
				reason: "over-budget",
			};
			kept.push(over);
			for (const member of group.members) {
				dropped.push({
					name: member.name,
					method: member.method,
					path: member.path,
					reason: "over-budget",
				});
			}
		}
	}

	return finalizePlan(ir, {
		preset,
		source: options.source ?? ir.meta.sourceFile,
		groups: kept,
		dropped: sortDropped(dropped),
	});
}

export function finalizePlan(
	ir: RuahToolSchema,
	input: {
		preset: CurationPlan["preset"];
		source: string;
		groups: CurationGroup[];
		dropped: CurationDropped[];
		drift?: CurationPlan["drift"];
	},
): CurationPlan {
	const keptGroups = input.groups.filter((group) => group.decision !== "drop");
	const curatedTools = countCuratedTools(keptGroups);
	const totalTokens = ir.tools.reduce(
		(sum, tool) => sum + toolDefinitionTokens(tool),
		0,
	);
	const curatedTokens = estimateKeptTokens(ir, keptGroups);
	const heaviest = [...ir.tools]
		.map((tool) => ({
			name: tool.name,
			estTokens: toolDefinitionTokens(tool),
		}))
		.sort((a, b) => b.estTokens - a.estTokens || a.name.localeCompare(b.name))
		.slice(0, 3);

	const plan: CurationPlan = {
		schemaVersion: "1",
		source: input.source,
		title: ir.meta.title,
		specVersion: ir.meta.version,
		preset: input.preset,
		totalTools: ir.tools.length,
		curatedTools,
		definitionTokens: totalTokens,
		curatedTokens,
		heaviest,
		groups: input.groups.map(sortGroupMembers),
		dropped: sortDropped(input.dropped),
		note: CURATION_NOTE,
	};
	if (input.drift) plan.drift = input.drift;
	return plan;
}

export function countCuratedTools(groups: CurationGroup[]): number {
	let count = 0;
	for (const group of groups) {
		if (group.decision === "drop") continue;
		if (group.decision === "split") {
			count += group.members.length;
		} else {
			count += 1;
		}
	}
	return count;
}

function estimateKeptTokens(
	ir: RuahToolSchema,
	groups: CurationGroup[],
): number {
	const byIdentity = new Map(
		ir.tools.map((tool) => [`${tool.method} ${tool.path}`, tool]),
	);
	let tokens = 0;
	for (const group of groups) {
		if (group.decision === "drop") continue;
		if (group.decision === "split" || group.members.length === 1) {
			for (const member of group.members) {
				const tool = byIdentity.get(`${member.method} ${member.path}`);
				tokens += tool ? toolDefinitionTokens(tool) : member.estTokens;
			}
			continue;
		}
		// Merged task tool is smaller than the sum: action enum + unique fields.
		const payload = {
			name: group.name,
			actions: group.members.map((member) => member.action).sort(),
			members: group.members.map((member) => ({
				method: member.method,
				path: member.path,
			})),
		};
		tokens += estimateDefinitionTokens(payload);
	}
	return tokens;
}

function sortGroupMembers(group: CurationGroup): CurationGroup {
	return {
		...group,
		members: [...group.members].sort(
			(a, b) =>
				b.score - a.score ||
				a.method.localeCompare(b.method) ||
				a.path.localeCompare(b.path),
		),
	};
}

function sortDropped(dropped: CurationDropped[]): CurationDropped[] {
	return [...dropped].sort(
		(a, b) =>
			a.path.localeCompare(b.path) ||
			a.method.localeCompare(b.method) ||
			a.name.localeCompare(b.name),
	);
}

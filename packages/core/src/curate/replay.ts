import type { HttpMethod } from "../ir/schema.js";
import type {
	CurationDecision,
	CurationDrift,
	CurationEndpointRef,
	CurationGroup,
	CurationPlan,
} from "./types.js";

const DECISIONS: ReadonlySet<CurationDecision> = new Set([
	"keep",
	"drop",
	"split",
]);

export function parseCurationPlan(value: unknown): CurationPlan {
	if (!value || typeof value !== "object") {
		throw new Error("curation plan must be a JSON object");
	}
	const raw = value as Record<string, unknown>;
	if (raw.schemaVersion !== "1") {
		throw new Error(
			`Unsupported curation plan schemaVersion "${String(raw.schemaVersion)}". Expected "1".`,
		);
	}
	if (!Array.isArray(raw.groups)) {
		throw new Error("curation plan is missing groups[]");
	}
	return raw as unknown as CurationPlan;
}

/**
 * Overlay saved decisions onto a freshly proposed plan and report drift.
 * Unknown saved groups are ignored (their endpoints appear in `removed`).
 * New spec endpoints appear in `added` and keep the proposed default.
 */
export function replayPlan(
	proposed: CurationPlan,
	saved: CurationPlan,
): { plan: CurationPlan; drift: CurationDrift } {
	const savedById = new Map(saved.groups.map((group) => [group.id, group]));
	const savedIdentities = new Set(
		saved.groups.flatMap((group) =>
			group.members.map((member) => identity(member.method, member.path)),
		),
	);
	const proposedIdentities = new Set(
		proposed.groups.flatMap((group) =>
			group.members.map((member) => identity(member.method, member.path)),
		),
	);

	const groups: CurationGroup[] = proposed.groups.map((group) => {
		const prior = savedById.get(group.id);
		if (!prior) return group;
		const decision = DECISIONS.has(prior.decision)
			? prior.decision
			: group.decision;
		return {
			...group,
			decision,
			reason: decision === group.decision ? group.reason : `plan:${decision}`,
		};
	});

	const added: CurationEndpointRef[] = [];
	const removed: CurationEndpointRef[] = [];

	for (const group of proposed.groups) {
		for (const member of group.members) {
			const key = identity(member.method, member.path);
			if (!savedIdentities.has(key)) {
				added.push(ref(member));
			}
		}
	}
	for (const group of saved.groups) {
		for (const member of group.members) {
			const key = identity(member.method, member.path);
			if (!proposedIdentities.has(key)) {
				removed.push(ref(member));
			}
		}
	}

	added.sort(compareRef);
	removed.sort(compareRef);

	const drift: CurationDrift = { added, removed };
	const dropped = proposed.dropped.filter((item) => {
		const group = groups.find((candidate) =>
			candidate.members.some(
				(member) => member.method === item.method && member.path === item.path,
			),
		);
		return !group || group.decision === "drop";
	});

	for (const group of groups) {
		if (group.decision !== "drop") continue;
		for (const member of group.members) {
			const already = dropped.some(
				(item) => item.method === member.method && item.path === member.path,
			);
			if (!already) {
				dropped.push({
					name: member.name,
					method: member.method,
					path: member.path,
					reason: group.reason,
				});
			}
		}
	}

	const plan: CurationPlan = {
		...proposed,
		groups,
		dropped,
		drift,
		curatedTools: groups
			.filter((group) => group.decision !== "drop")
			.reduce(
				(sum, group) =>
					sum + (group.decision === "split" ? group.members.length : 1),
				0,
			),
	};

	return { plan, drift };
}

function identity(method: HttpMethod, path: string): string {
	return `${method} ${path}`;
}

function ref(member: {
	name: string;
	method: HttpMethod;
	path: string;
}): CurationEndpointRef {
	return { name: member.name, method: member.method, path: member.path };
}

function compareRef(a: CurationEndpointRef, b: CurationEndpointRef): number {
	return (
		a.path.localeCompare(b.path) ||
		a.method.localeCompare(b.method) ||
		a.name.localeCompare(b.name)
	);
}

import { parseOpenAPI } from "./openapi.js";

export function parseSwagger(filePath: string, doc: Record<string, unknown>) {
	const upgraded = upgradeSwaggerToOpenAPI(doc);
	const parsed = parseOpenAPI(filePath, upgraded);

	return {
		...parsed,
		meta: {
			...parsed.meta,
			sourceFormat: "swagger-2.0" as const,
		},
	};
}

function upgradeSwaggerToOpenAPI(
	doc: Record<string, unknown>,
): Record<string, unknown> {
	const consumes = ensureStringArray(doc.consumes);
	const produces = ensureStringArray(doc.produces);

	return {
		openapi: "3.0.3",
		info: doc.info ?? {},
		servers: buildServers(doc),
		security: doc.security ?? undefined,
		paths: upgradePaths(doc.paths as Record<string, unknown> | undefined, {
			consumes,
			produces,
		}),
		components: {
			schemas:
				(doc.definitions as Record<string, Record<string, unknown>>) ?? {},
			// Swagger 2.0 stores reusable parameters under `#/parameters/<Name>`;
			// OpenAPI 3 expects `#/components/parameters/<Name>`. Lift them so the
			// OpenAPI parser can resolve $ref parameters emitted by upgradePaths.
			parameters: upgradeReusableParameters(
				doc.parameters as Record<string, Record<string, unknown>> | undefined,
			),
			securitySchemes: upgradeSecuritySchemes(
				doc.securityDefinitions as Record<string, Record<string, unknown>>,
			),
		},
	};
}

function upgradeReusableParameters(
	parameters: Record<string, Record<string, unknown>> | undefined,
): Record<string, Record<string, unknown>> {
	const result: Record<string, Record<string, unknown>> = {};
	for (const [name, param] of Object.entries(parameters ?? {})) {
		// Don't upgrade body/formData reusables — those become request bodies in
		// OpenAPI 3 and aren't valid parameter entries.
		const where = String(param.in ?? "");
		if (where === "body" || where === "formData") continue;
		result[name] = upgradeParameter(param);
	}
	return result;
}

function rewriteParameterRef(
	param: Record<string, unknown>,
): Record<string, unknown> {
	const ref = param.$ref;
	if (typeof ref !== "string") return param;
	// Swagger ref → OpenAPI 3 ref. Leave unknown shapes alone.
	if (ref.startsWith("#/parameters/")) {
		return {
			$ref: `#/components/parameters/${ref.slice("#/parameters/".length)}`,
		};
	}
	return param;
}

function buildServers(doc: Record<string, unknown>): Array<{ url: string }> {
	const host = String(doc.host ?? "").trim();
	const basePath = String(doc.basePath ?? "").trim();
	const schemes = ensureStringArray(doc.schemes);

	if (!host) {
		return [];
	}

	const scheme = schemes[0] ?? "https";
	return [
		{
			url: `${scheme}://${host}${basePath}`,
		},
	];
}

function upgradeSecuritySchemes(
	securityDefinitions: Record<string, Record<string, unknown>> | undefined,
): Record<string, Record<string, unknown>> {
	const result: Record<string, Record<string, unknown>> = {};

	for (const [name, scheme] of Object.entries(securityDefinitions ?? {})) {
		if (scheme.type === "basic") {
			result[name] = {
				type: "http",
				scheme: "basic",
				description: scheme.description,
			};
			continue;
		}

		result[name] = { ...scheme };
	}

	return result;
}

function upgradePaths(
	paths: Record<string, unknown> | undefined,
	defaults: { consumes: string[]; produces: string[] },
): Record<string, unknown> {
	const upgraded: Record<string, unknown> = {};

	for (const [pathName, pathValue] of Object.entries(paths ?? {})) {
		const pathItem = (pathValue as Record<string, unknown>) ?? {};
		const nextPathItem: Record<string, unknown> = {};

		if (Array.isArray(pathItem.parameters)) {
			nextPathItem.parameters = (
				pathItem.parameters as Array<Record<string, unknown>>
			).map(rewriteParameterRef);
		}

		for (const [method, operationValue] of Object.entries(pathItem)) {
			if (!isOperationMethod(method)) {
				continue;
			}
			nextPathItem[method] = upgradeOperation(
				(operationValue as Record<string, unknown>) ?? {},
				defaults,
			);
		}

		upgraded[pathName] = nextPathItem;
	}

	return upgraded;
}

function upgradeOperation(
	operation: Record<string, unknown>,
	defaults: { consumes: string[]; produces: string[] },
): Record<string, unknown> {
	const parameters = Array.isArray(operation.parameters)
		? (operation.parameters as Array<Record<string, unknown>>)
		: [];
	const consumes = ensureStringArray(operation.consumes, defaults.consumes);
	const produces = ensureStringArray(operation.produces, defaults.produces);

	const requestBody = buildRequestBody(parameters, consumes);
	const openApiParameters = parameters
		.filter((param) => {
			// $ref entries always pass through — body/formData reusables are
			// dropped at the reusable-parameter level via upgradeReusableParameters.
			if (typeof param.$ref === "string") return true;
			return !["body", "formData"].includes(String(param.in ?? ""));
		})
		.map((param) =>
			typeof param.$ref === "string"
				? rewriteParameterRef(param)
				: upgradeParameter(param),
		);

	return {
		...operation,
		parameters: openApiParameters,
		requestBody,
		responses: upgradeResponses(
			operation.responses as
				| Record<string, Record<string, unknown>>
				| undefined,
			produces,
		),
	};
}

function buildRequestBody(
	parameters: Array<Record<string, unknown>>,
	consumes: string[],
): Record<string, unknown> | undefined {
	const bodyParam = parameters.find(
		(param) => String(param.in ?? "") === "body",
	);
	if (bodyParam) {
		const contentType = consumes[0] ?? "application/json";
		return {
			required: bodyParam.required === true,
			description: bodyParam.description,
			content: {
				[contentType]: {
					schema: (bodyParam.schema as Record<string, unknown> | undefined) ?? {
						type: "object",
					},
				},
			},
		};
	}

	const formParams = parameters.filter(
		(param) => String(param.in ?? "") === "formData",
	);
	if (formParams.length === 0) {
		return undefined;
	}

	const isMultipart = formParams.some(
		(param) => String(param.type ?? "") === "file",
	);
	const properties: Record<string, unknown> = {};
	const required: string[] = [];

	for (const param of formParams) {
		properties[String(param.name ?? "field")] = upgradeSchemaOrParameter(param);
		if (param.required === true) {
			required.push(String(param.name ?? "field"));
		}
	}

	return {
		required: required.length > 0,
		description: "Generated from Swagger formData parameters.",
		content: {
			[isMultipart
				? "multipart/form-data"
				: "application/x-www-form-urlencoded"]: {
				schema: {
					type: "object",
					properties,
					required,
				},
			},
		},
	};
}

function upgradeResponses(
	responses: Record<string, Record<string, unknown>> | undefined,
	produces: string[],
): Record<string, unknown> {
	const upgraded: Record<string, unknown> = {};

	for (const [statusCode, response] of Object.entries(responses ?? {})) {
		if (response.schema) {
			upgraded[statusCode] = {
				...response,
				content: {
					[produces[0] ?? "application/json"]: {
						schema: response.schema,
					},
				},
			};
			continue;
		}

		upgraded[statusCode] = response;
	}

	return upgraded;
}

function upgradeParameter(
	param: Record<string, unknown>,
): Record<string, unknown> {
	if (param.schema) {
		return param;
	}

	return {
		...param,
		schema: upgradeSchemaOrParameter(param),
	};
}

function upgradeSchemaOrParameter(
	source: Record<string, unknown>,
): Record<string, unknown> {
	if (source.type === "file") {
		return {
			type: "string",
			format: "binary",
			description: source.description,
		};
	}

	const schema: Record<string, unknown> = {};
	for (const key of [
		"type",
		"format",
		"pattern",
		"minimum",
		"maximum",
		"items",
		"enum",
		"description",
		"default",
	]) {
		if (key in source) {
			schema[key] = source[key];
		}
	}

	if (source.type === "array" && !schema.items) {
		schema.items = { type: "string" };
	}

	return Object.keys(schema).length > 0 ? schema : { type: "string" };
}

function ensureStringArray(value: unknown, fallback: string[] = []): string[] {
	return Array.isArray(value) ? value.map((entry) => String(entry)) : fallback;
}

function isOperationMethod(method: string): boolean {
	return ["get", "post", "put", "patch", "delete", "head", "options"].includes(
		method,
	);
}

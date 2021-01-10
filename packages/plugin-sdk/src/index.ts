import { PluginFunction, PluginValidateFn, Types } from "@graphql-codegen/plugin-helpers";
import { DocumentMode } from "@graphql-codegen/visitor-plugin-common";
import { ContextVisitor, filterJoin, logger, nonNullable, PluginContext } from "@linear/plugin-common";
import { GraphQLSchema, parse, printSchema, visit } from "graphql";
import { extname } from "path";
import { printSdkClasses } from "./class";
import c from "./constants";
import { getSdkDefinitions } from "./definitions";
import { printSdkModels } from "./model";
import { ModelVisitor } from "./model-visitor";
import { printRequesterType } from "./requester";
import { RawSdkPluginConfig, SdkModel, SdkPluginContext } from "./types";

/**
 * Graphql-codegen plugin for outputting the typed Linear sdk
 */
export const plugin: PluginFunction<RawSdkPluginConfig> = async (
  schema: GraphQLSchema,
  documents: Types.DocumentFile[],
  config: RawSdkPluginConfig
) => {
  try {
    /** Get ast from schema */
    const ast = parse(printSchema(schema));

    /** Collect plugin context */
    logger.info("Gathering context");
    const contextVisitor = new ContextVisitor(schema, config);
    visit(ast, contextVisitor);
    const context: PluginContext<RawSdkPluginConfig> = {
      ...contextVisitor.context,
      fragments: [],
    };

    /** Print the query return types  */
    logger.info("Generating models");
    const modelVisitor = new ModelVisitor(context);
    const models = visit(ast, modelVisitor) as SdkModel[];
    logger.debug({ models: models.map(model => model.name) });

    /** Process a list of documents to add information for chaining the api operations */
    logger.info("Processing documents");
    const sdkDefinitions = getSdkDefinitions(context, documents, models);
    logger.debug(sdkDefinitions);
    const sdkContext: SdkPluginContext = {
      ...context,
      models,
      sdkDefinitions,
    };

    /** Print the models  */
    logger.info("Generating models");
    const printedModels = printSdkModels(sdkContext);

    /** Print the query return types  */
    logger.info("Generating operations");
    const printedOperations = printSdkClasses(sdkContext);

    // /** Print each api definition  */
    // const printedDefinitions = Object.entries(sdkDefinitions).map(([apiKey, definition]) => {
    //   logger.info("Generating api", apiKey);

    //   return printSdkDefinition(sdkContext, definition);
    // });

    logger.info("Printing api");
    return {
      /** Add any initial imports */
      prepend: [
        /** Ignore unused variables */
        "/* eslint-disable @typescript-eslint/no-unused-vars */",
        /** Import DocumentNode if required */
        config.documentMode !== DocumentMode.string ? `import { DocumentNode } from 'graphql'` : undefined,
        /** Import ResultOf util for document return types */
        `import { ResultOf } from '@graphql-typed-document-node/core'`,
      ].filter(nonNullable),
      content: filterJoin(
        [
          /** Import and export documents */
          `import * as ${c.NAMESPACE_DOCUMENT} from '${config.documentFile}'`,
          `export * from '${config.documentFile}'\n`,
          /** Print the requester function */
          ...printRequesterType(config),
          /** Print the query return types */
          printedModels,
          printedOperations,
        ],
        "\n"
      ),
    };
  } catch (e) {
    logger.fatal(e);
    throw e;
  }
};

/**
 * Validate use of the plugin
 */
export const validate: PluginValidateFn = async (
  schema: GraphQLSchema,
  documents: Types.DocumentFile[],
  config: RawSdkPluginConfig,
  outputFile: string
) => {
  const packageName = "@linear/plugin-sdk";
  logger.info(`Validating ${packageName}`);
  logger.debug({ config });

  const prefix = `Plugin "${packageName}" config requires`;

  if (extname(outputFile) !== ".ts") {
    throw new Error(`${prefix} output file extension to be ".ts" but is "${outputFile}"`);
  }

  if (!config.documentFile || typeof config.documentFile !== "string") {
    throw new Error(`${prefix} documentFile to be a string path to a document file generated by "typed-document-node"`);
  }
};

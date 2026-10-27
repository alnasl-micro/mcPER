#!/usr/bin/env node
// mcPER: MCP server exposing the Fiat ePER v84 parts catalogue.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { config } from './config.js';
import { all } from './db.js';
import { decodeVin, describeVehicleOptions, resolveVehicle } from './vehicle.js';
import { getModification } from './filter/modif.js';
import {
  MAKES, getAssembly, getAssemblyImages, getCatalogue, getDrawingImage, getPart, getPartHistory, getTableParts,
  listCatalogues, listGroups, listSubgroups, listTables, searchParts, whereUsed,
} from './catalog.js';
import { highlight, mimeType, parseHotspots, readImage } from './images.js';

const ISO_TO_EPER = {
  it: '0', fr: '1', es: '2', en: '3', de: '4', pt: '5', pl: '6', nl: '7', da: '9', cs: 'B', el: 'D',
  ja: 'J', zh: 'K', ru: 'N', tr: 'T', ro: 'R', sr: 'S', sk: 'L', hu: 'H', sv: 'V',
};

function eperLang(lang) {
  if (!lang) return config.defaultLanguage;
  const l = lang.trim();
  return ISO_TO_EPER[l.toLowerCase()] ?? l.toUpperCase();
}

const lang = z.string().optional()
  .describe('Language for descriptions: ISO code (ja, en, it, de, ...) or ePER code. Default ja; falls back to English.');
const vin = z.string().optional().describe('17-character VIN. When given, each item gets fits = yes/no/maybe for this vehicle.');
const mvs = z.string().optional().describe('SINCOM/MVS version code (e.g. "183.829.0.0") when no VIN is available; less precise than a VIN.');
const drive = z.enum(['L', 'R']).optional()
  .describe('Force left (L) or right (R) hand drive, like the ePER drive selector. Default: from the VIN, else left.');
const cat = z.string().describe('Catalogue code (CAT_COD), e.g. "PK". Get it from decode_vin or list_catalogues.');

const server = new McpServer(
  { name: 'mcper', version: '0.1.0' },
  {
    instructions: `Fiat/Lancia/Alfa Romeo/Abarth parts catalogue (ePER release 84, data 2014).
Typical workflow for "which part number fits this car":
1. decode_vin -> catalogue code, version, build date, options.
2. search_parts(query, vin) to find the part by name (Japanese or English), or browse
   list_groups -> list_subgroups -> list_tables -> get_table_parts with the vin.
   Items with fits="no" do not fit this vehicle (reasons explain why: option pattern or
   modification cut-over by build date/chassis/organization number). fits="maybe" means it
   depends on options that are not recorded for the vehicle.
3. get_part_history(part_number) to follow supersessions to the latest number known to ePER.
4. get_drawing_image (table drawing) or get_assembly_image (exploded view of an assembly) to show
   the picture with the reference numbers of the relevant parts framed in red.
Notes: ePER data ends in 2014; supersessions after that are not included. ePER does not tell
whether a part can be ordered today, so do not state availability (orderable/discontinued/out of
stock); suggest checking current availability with a dealer instead.`,
  },
);

function tool(name, description, inputSchema, handler) {
  server.registerTool(name, { description, inputSchema }, async (args) => {
    try {
      const result = await handler(args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `Error: ${e.message}` }] };
    }
  });
}

// Returns the drawing as MCP image content, framing the selected reference numbers.
function imageResult(view, { refs = [], partNumbers = [] } = {}) {
  const png = readImage(view.imgPath);
  if (!png) throw new Error(`Image ${view.imgPath} not found in ${config.imagesDir}`);
  const wanted = view.refs.filter((r) => refs.includes(r.ref) || partNumbers.includes(r.part_number));
  const rects = wanted.flatMap((r) => parseHotspots(r.hotspots));
  const data = rects.length ? highlight(png, rects) : png;
  const framed = [...new Set(wanted.map((r) => r.ref))];
  const missing = partNumbers.filter((pn) => !view.refs.some((r) => r.part_number === pn));
  return {
    content: [
      { type: 'image', data: data.toString('base64'), mimeType: rects.length ? 'image/png' : mimeType(view.imgPath) },
      {
        type: 'text',
        text: JSON.stringify({
          drawing: view.title,
          framed_refs: framed.length ? framed : undefined,
          not_in_this_drawing: missing.length ? missing : undefined,
        }),
      },
    ],
  };
}

function imageTool(name, description, inputSchema, handler) {
  server.registerTool(name, { description, inputSchema }, async (args) => {
    try {
      return await handler(args);
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `Error: ${e.message}` }] };
    }
  });
}

function vehicleFor(args, catalogue) {
  return resolveVehicle({ vin: args.vin, mvs: args.mvs, drive: args.drive, cat: catalogue }, eperLang(args.lang)).context;
}

tool(
  'decode_vin',
  'Decode a VIN using ePER chassis data: model, MVS version, catalogue(s), build date, engine number, organization number, colours and factory options (CARATT).',
  { vin: z.string().describe('17-character VIN'), include_options: z.boolean().optional().describe('Describe each option code (default true)'), lang },
  ({ vin: v, include_options = true, lang: l }) => {
    const L = eperLang(l);
    const results = decodeVin(v, L);
    if (!results.length) return { found: false, message: 'VIN not found in ePER chassis data (data ends 2014)' };
    return results.map(({ _cutoffs, ...r }) => ({
      ...r,
      catalogues: r.catalogues.filter((c) => c.best_match).map(({ best_match, ...c }) => c),
      other_versions_with_same_mvs: r.catalogues.filter((c) => !c.best_match)
        .map((c) => `${c.sincom} ${c.version_description}`),
      ...(include_options && r.catalogues[0] ? { options: describeVehicleOptions(r.catalogues[0].catalogue, r, L) } : {}),
    }));
  },
);

tool(
  'list_catalogues',
  'List catalogues (model ranges). Filter by sub-make (F=Fiat, T=Fiat Commercial, L=Lancia, R=Alfa Romeo, C=Abarth) and/or text in the description.',
  { make: z.string().optional().describe('Sub-make code: F, T, L, R or C'), query: z.string().optional().describe('Text in catalogue/model name, e.g. "PUNTO"') },
  ({ make, query }) => ({ makes: make ? undefined : MAKES, catalogues: listCatalogues({ make, query }) }),
);

tool(
  'list_groups',
  'List the main groups of a catalogue (engine, brakes, body, ...).',
  { catalogue: cat, lang },
  ({ catalogue, lang: l }) => ({ catalogue: getCatalogue(catalogue), groups: listGroups(catalogue, eperLang(l)) }),
);

tool(
  'list_subgroups',
  'List the subgroups of a group in a catalogue.',
  { catalogue: cat, group: z.number().int(), lang },
  ({ catalogue, group, lang: l }) => listSubgroups(catalogue, group, eperLang(l)),
);

tool(
  'list_tables',
  'List the parts tables (drawings) of a subgroup, with their applicability. Pass vin to see which tables fit the vehicle.',
  { catalogue: cat, group: z.number().int(), subgroup: z.number().int(), vin, mvs, drive, lang },
  (a) => listTables(a.catalogue, a.group, a.subgroup, vehicleFor(a, a.catalogue), eperLang(a.lang)),
);

tool(
  'get_table_parts',
  'Get the parts list of a table (drawing): reference number, part number, quantity, description, notes, option pattern and modifications. Pass vin to evaluate fitment for that vehicle.',
  {
    catalogue: cat,
    group: z.number().int(),
    subgroup: z.number().int(),
    sgs_code: z.number().int().describe('Sub-subgroup code from list_tables'),
    variante: z.number().int().optional().describe('Drawing variant; omit for all variants'),
    only_fitting: z.boolean().optional().describe('With vin/mvs: drop parts with fits="no" (default false)'),
    vin, mvs, drive, lang,
  },
  (a) => getTableParts(a.catalogue, a.group, a.subgroup, a.sgs_code, {
    variante: a.variante,
    vehicle: vehicleFor(a, a.catalogue),
    includeExcluded: !a.only_fitting,
  }, eperLang(a.lang)),
);

tool(
  'search_parts',
  'Search a catalogue for parts by description words (all words must match; Japanese or English) or by part number prefix. ePER Japanese names are terse katakana (e.g. "パッド セット" for brake pads, "フィルタ" for filters); if nothing matches, retry with a shorter word or English ("PADS", "OIL FILTER"), or browse groups. With vin the catalogue is taken from the VIN and results are sorted by fitment.',
  {
    query: z.string(),
    group: z.number().int().optional().describe('Restrict to one main group (see list_groups)'),
    catalogue: z.string().optional().describe('Catalogue code; optional when vin is given'),
    vin, mvs, drive,
    limit: z.number().int().optional().describe('Max results (default 50)'),
    lang,
  },
  (a) => {
    const L = eperLang(a.lang);
    const { decoded, context } = resolveVehicle({ vin: a.vin, mvs: a.mvs, drive: a.drive, cat: a.catalogue }, L);
    const catalogue = a.catalogue ?? context?.cat;
    if (!catalogue) throw new Error('Specify catalogue or vin');
    return {
      catalogue: getCatalogue(catalogue),
      vehicle: decoded ? { vin: decoded.vin, mvs: decoded.mvs, build_date: decoded.build_date } : undefined,
      ...searchParts({ query: a.query, cat: catalogue, group: a.group, vehicle: context, limit: a.limit ?? 50 }, L),
    };
  },
);

tool(
  'get_part',
  'Get details of a part number: description, family, unit, weight, counts of supersessions, and the components if it is an assembly.',
  { part_number: z.string(), lang },
  ({ part_number, lang: l }) => {
    const L = eperLang(l);
    const part = getPart(part_number.trim(), L);
    if (!part) return { found: false };
    const components = getAssembly(part.part_number, L);
    return { ...part, assembly_components: components.length ? components : undefined };
  },
);

tool(
  'get_part_history',
  'Follow the supersession (replacement) chain of a part number in both directions: which numbers replaced it (with dates, quantity ratios and interchangeability) and which older numbers it replaced. current_parts lists the end(s) of the chain.',
  { part_number: z.string(), max_depth: z.number().int().optional().describe('Max steps each way (default 10)'), lang },
  ({ part_number, max_depth, lang: l }) => getPartHistory(part_number.trim(), max_depth ?? 10, eperLang(l)),
);

tool(
  'where_used',
  'List the catalogue tables where a part number is used, and assemblies/kits that contain it.',
  { part_number: z.string(), catalogue: z.string().optional(), limit: z.number().int().optional(), lang },
  ({ part_number, catalogue, limit, lang: l }) => whereUsed(part_number.trim(), { cat: catalogue, limit: limit ?? 100 }, eperLang(l)),
);

tool(
  'get_modification',
  'Describe a modification code (from a MODIF field such as "D2105") and its cut-over points (build date, chassis, engine, organization number).',
  { catalogue: cat, code: z.number().int().describe('Modification number without the D/C prefix'), lang },
  ({ catalogue, code, lang: l }) => getModification(catalogue, code, eperLang(l)),
);

const highlightArgs = {
  highlight_refs: z.array(z.number().int()).optional().describe('Reference numbers to frame in red'),
  highlight_parts: z.array(z.string()).optional().describe('Part numbers whose reference numbers are framed in red'),
};

imageTool(
  'get_drawing_image',
  'Show the exploded-view drawing of a parts table (same keys as get_table_parts). The reference numbers of the given parts are framed in red so the user can see where they are.',
  {
    catalogue: cat,
    group: z.number().int(),
    subgroup: z.number().int(),
    sgs_code: z.number().int(),
    variante: z.number().int().optional().describe('Drawing variant; default the first'),
    ...highlightArgs,
  },
  (a) => {
    const view = getDrawingImage(a.catalogue, a.group, a.subgroup, a.sgs_code, a.variante);
    if (!view) throw new Error('Drawing not found');
    return imageResult(view, { refs: a.highlight_refs, partNumbers: a.highlight_parts });
  },
);

imageTool(
  'get_assembly_image',
  'Show the exploded view (cliché) of an assembly part, e.g. a brake caliper with its pads and seals (parts with has_components or inside_assembly). Component reference numbers can be framed in red.',
  {
    part_number: z.string().describe('Assembly part number'),
    view: z.number().int().optional().describe('View index when the assembly has several (default 0)'),
    ...highlightArgs,
  },
  (a) => {
    const views = getAssemblyImages(a.part_number.trim());
    if (!views.length) throw new Error(`No exploded view for ${a.part_number}`);
    const view = views[a.view ?? 0] ?? views[0];
    const result = imageResult(view, { refs: a.highlight_refs, partNumbers: a.highlight_parts });
    if (views.length > 1) result.content.push({ type: 'text', text: `This assembly has ${views.length} views (view 0-${views.length - 1}).` });
    return result;
  },
);

tool(
  'list_languages',
  'List languages available in the catalogue.',
  {},
  () => all('SELECT LNG_COD AS code, LNG_DSC AS name FROM LANG'),
);

await server.connect(new StdioServerTransport());

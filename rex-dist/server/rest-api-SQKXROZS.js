import {
  FigmaClient,
  deleteComment,
  getComments,
  postComment
} from "./chunk-WMOEZE4I.js";
import "./chunk-ZSHX4C3A.js";

// src/rest-api/files.ts
async function getFile(client, fileKey, params) {
  const queryParams = {};
  if (params?.version) queryParams["version"] = params.version;
  if (params?.ids) queryParams["ids"] = params.ids;
  if (params?.depth !== void 0) queryParams["depth"] = params.depth;
  if (params?.geometry) queryParams["geometry"] = params.geometry;
  if (params?.plugin_data) queryParams["plugin_data"] = params.plugin_data;
  if (params?.branch_data) queryParams["branch_data"] = params.branch_data;
  return client.get(`/files/${fileKey}`, { params: queryParams });
}
async function getFileNodes(client, fileKey, nodeIds, params) {
  const queryParams = {
    ids: nodeIds
  };
  if (params?.version) queryParams["version"] = params.version;
  if (params?.depth !== void 0) queryParams["depth"] = params.depth;
  if (params?.geometry) queryParams["geometry"] = params.geometry;
  if (params?.plugin_data) queryParams["plugin_data"] = params.plugin_data;
  return client.get(`/files/${fileKey}/nodes`, { params: queryParams });
}
async function getFileVersions(client, fileKey) {
  return client.get(`/files/${fileKey}/versions`);
}

// src/rest-api/components.ts
async function getFileComponents(client, fileKey) {
  return client.get(`/files/${fileKey}/components`);
}
async function getFileComponentSets(client, fileKey) {
  return client.get(`/files/${fileKey}/component_sets`);
}

// src/rest-api/variables.ts
async function getLocalVariables(client, fileKey) {
  return client.get(`/files/${fileKey}/variables/local`);
}
async function getPublishedVariables(client, fileKey) {
  return client.get(`/files/${fileKey}/variables/published`);
}

// src/rest-api/images.ts
async function getImage(client, fileKey, nodeIds, params) {
  const queryParams = {
    ids: nodeIds
  };
  if (params?.scale !== void 0) queryParams["scale"] = params.scale;
  if (params?.format) queryParams["format"] = params.format;
  if (params?.svg_include_id !== void 0) queryParams["svg_include_id"] = params.svg_include_id;
  if (params?.svg_simplify_stroke !== void 0) queryParams["svg_simplify_stroke"] = params.svg_simplify_stroke;
  if (params?.svg_outline_text !== void 0) queryParams["svg_outline_text"] = params.svg_outline_text;
  if (params?.use_absolute_bounds !== void 0) queryParams["use_absolute_bounds"] = params.use_absolute_bounds;
  if (params?.version) queryParams["version"] = params.version;
  return client.get(`/images/${fileKey}`, {
    params: queryParams,
    cacheTtlMs: 1e4
  });
}
export {
  FigmaClient,
  deleteComment,
  getComments,
  getFile,
  getFileComponentSets,
  getFileComponents,
  getFileNodes,
  getFileVersions,
  getImage,
  getLocalVariables,
  getPublishedVariables,
  postComment
};
//# sourceMappingURL=rest-api-SQKXROZS.js.map
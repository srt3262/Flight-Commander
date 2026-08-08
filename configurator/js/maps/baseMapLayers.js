"use strict";

import TileLayer from "ol/layer/Tile.js";
import OSM from "ol/source/OSM.js";
import XYZ from "ol/source/XYZ.js";

export const MAP_STYLES = Object.freeze({
  STREET: "street",
  HYBRID: "hybrid",
});

const DEFAULT_MAP_STYLE = MAP_STYLES.STREET;
const BASE_MAP_STYLE_PROPERTY = "flightCommanderMapStyle";
const BASE_MAP_ROLE_PROPERTY = "flightCommanderMapRole";

const ESRI_TILE_URLS = Object.freeze({
  imagery:
    "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  transportation:
    "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
  places:
    "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
});

const SOURCE_ATTRIBUTIONS = Object.freeze({
  osm: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
  esri: "Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
});

const MANUAL_ATTRIBUTIONS = Object.freeze({
  [MAP_STYLES.STREET]: "Map data © OpenStreetMap contributors",
  [MAP_STYLES.HYBRID]:
    "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community · Labels © Esri",
});

const STYLE_ALIASES = Object.freeze({
  osm: MAP_STYLES.STREET,
  esri: MAP_STYLES.HYBRID,
});

export function normalizeMapStyle(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return Object.values(MAP_STYLES).includes(normalized)
    ? normalized
    : (STYLE_ALIASES[normalized] ?? DEFAULT_MAP_STYLE);
}

export function mapAttribution(style) {
  return MANUAL_ATTRIBUTIONS[normalizeMapStyle(style)];
}

function tagLayer(layer, style, role) {
  layer.set(BASE_MAP_STYLE_PROPERTY, style);
  layer.set(BASE_MAP_ROLE_PROPERTY, role);
  return layer;
}

export function createBaseMapLayers(style = DEFAULT_MAP_STYLE) {
  const normalized = normalizeMapStyle(style);
  const street = tagLayer(
    new TileLayer({
      visible: normalized === MAP_STYLES.STREET,
      source: new OSM({ attributions: SOURCE_ATTRIBUTIONS.osm }),
    }),
    MAP_STYLES.STREET,
    "street",
  );

  const hybrid = [
    ["imagery", ESRI_TILE_URLS.imagery],
    ["transportation", ESRI_TILE_URLS.transportation],
    ["places", ESRI_TILE_URLS.places],
  ].map(([role, url], index) =>
    tagLayer(
      new TileLayer({
        visible: normalized === MAP_STYLES.HYBRID,
        source: new XYZ({
          url,
          maxZoom: 19,
          attributions: index === 0 ? SOURCE_ATTRIBUTIONS.esri : undefined,
        }),
      }),
      MAP_STYLES.HYBRID,
      role,
    ),
  );

  return [street, ...hybrid];
}

export function setBaseMapStyle(layers, style) {
  const normalized = normalizeMapStyle(style);
  for (const layer of layers ?? []) {
    const layerStyle = layer?.get?.(BASE_MAP_STYLE_PROPERTY);
    if (layerStyle === MAP_STYLES.STREET || layerStyle === MAP_STYLES.HYBRID) {
      layer.setVisible(layerStyle === normalized);
    }
  }
  return normalized;
}

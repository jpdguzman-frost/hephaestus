// ─── Component Executors ────────────────────────────────────────────────────
// INSTANTIATE_COMPONENT, SET_INSTANCE_PROPERTIES, CREATE_COMPONENT,
// CREATE_COMPONENT_SET, ADD/EDIT/DELETE_COMPONENT_PROPERTY, SET_DESCRIPTION

import { serializeNode } from "../serializer";

/**
 * Create an instance of a component (local or from library).
 */
export async function executeInstantiateComponent(payload: Record<string, unknown>): Promise<unknown> {
  let component: ComponentNode | null = null;

  if (payload.componentKey) {
    // Published/library component — import by key
    try {
      component = await figma.importComponentByKeyAsync(payload.componentKey as string);
    } catch (e) {
      throw new Error(`Could not import component with key "${payload.componentKey}": ${e}`);
    }
  } else if (payload.nodeId) {
    // Local component — get by node ID
    const node = figma.getNodeById(payload.nodeId as string);
    if (!node || node.type !== "COMPONENT") {
      throw new Error(`Node ${payload.nodeId} is not a component`);
    }
    component = node as ComponentNode;
  } else {
    throw new Error("Must provide either componentKey or nodeId");
  }

  if (!component) throw new Error("Component not found");

  // If variant properties are specified, find the matching variant
  if (payload.variant && component.parent && component.parent.type === "COMPONENT_SET") {
    const componentSet = component.parent as ComponentSetNode;
    const variant = payload.variant as Record<string, string>;
    const variantName = Object.entries(variant).map(([k, v]) => `${k}=${v}`).join(", ");

    const matchingVariant = componentSet.children.find(
      child => child.type === "COMPONENT" && child.name === variantName
    ) as ComponentNode | undefined;

    if (matchingVariant) {
      component = matchingVariant;
    }
  }

  const instance = component.createInstance();

  // Place in parent
  if (payload.parentId) {
    const parent = figma.getNodeById(payload.parentId as string);
    if (parent && "children" in parent) {
      (parent as ChildrenMixin).appendChild(instance);
    }
  }

  // Set position
  if (payload.position) {
    const pos = payload.position as { x: number; y: number };
    instance.x = pos.x;
    instance.y = pos.y;
  }

  // Apply overrides
  if (payload.overrides) {
    const overrides = payload.overrides as Record<string, string | boolean>;
    for (const [propName, value] of Object.entries(overrides)) {
      try {
        instance.setProperties({ [propName]: value });
      } catch {
        console.warn(`Could not set property "${propName}" on instance`);
      }
    }
  }

  return serializeNode(instance, 1);
}

/**
 * Update properties on a component instance.
 */
export async function executeSetInstanceProperties(payload: Record<string, unknown>): Promise<unknown> {
  const nodeId = payload.nodeId as string;
  const node = figma.getNodeById(nodeId) as InstanceNode;
  if (!node || node.type !== "INSTANCE") {
    throw new Error(`Node ${nodeId} is not a component instance`);
  }

  const properties = payload.properties as Record<string, string | boolean>;

  // Reset overrides first if specified
  if (payload.resetOverrides) {
    const resets = payload.resetOverrides as string[];
    for (const propName of resets) {
      try {
        node.resetOverrides();
      } catch {
        // Ignore reset failures
      }
    }
  }

  // Set properties
  if (properties) {
    node.setProperties(properties);
  }

  return serializeNode(node, 1);
}

/**
 * Convert an existing frame to a component.
 */
export async function executeCreateComponent(payload: Record<string, unknown>): Promise<unknown> {
  const nodeId = payload.nodeId as string;
  const node = figma.getNodeById(nodeId) as FrameNode;
  if (!node) throw new Error(`Node ${nodeId} not found`);

  const component = figma.createComponent();
  component.name = node.name;

  // Copy dimensions
  component.resize(node.width, node.height);
  component.x = node.x;
  component.y = node.y;

  // Move children from frame to component
  while (node.children.length > 0) {
    component.appendChild(node.children[0]);
  }

  // Copy properties
  if (node.fills !== figma.mixed) component.fills = node.fills;
  component.strokes = node.strokes;
  component.effects = node.effects;
  component.clipsContent = node.clipsContent;

  if (node.layoutMode !== "NONE") {
    component.layoutMode = node.layoutMode;
    component.itemSpacing = node.itemSpacing;
    component.paddingTop = node.paddingTop;
    component.paddingRight = node.paddingRight;
    component.paddingBottom = node.paddingBottom;
    component.paddingLeft = node.paddingLeft;
    component.primaryAxisAlignItems = node.primaryAxisAlignItems;
    component.counterAxisAlignItems = node.counterAxisAlignItems;
    component.primaryAxisSizingMode = node.primaryAxisSizingMode;
    component.counterAxisSizingMode = node.counterAxisSizingMode;
  }

  // Insert component where frame was
  if (node.parent) {
    const idx = node.parent.children.indexOf(node);
    (node.parent as ChildrenMixin).insertChild(idx, component);
  }

  // Set description
  if (payload.description) {
    component.description = payload.description as string;
  }

  // Remove original frame
  node.remove();

  return {
    ...serializeNode(component, 1),
    componentKey: component.key,
  };
}

/**
 * Combine multiple components into a component set (variant group).
 */
export async function executeCreateComponentSet(payload: Record<string, unknown>): Promise<unknown> {
  const componentIds = payload.componentIds as string[];
  const components: ComponentNode[] = [];

  for (const id of componentIds) {
    const node = figma.getNodeById(id) as ComponentNode;
    if (!node || node.type !== "COMPONENT") {
      throw new Error(`Node ${id} is not a component`);
    }
    components.push(node);
  }

  const componentSet = figma.combineAsVariants(components, figma.currentPage);

  if (payload.name) {
    componentSet.name = payload.name as string;
  }

  return serializeNode(componentSet, 1);
}

/**
 * Add a property to a component or component set.
 */
export async function executeAddComponentProperty(payload: Record<string, unknown>): Promise<unknown> {
  const nodeId = payload.nodeId as string;
  const node = figma.getNodeById(nodeId);
  if (!node || (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET")) {
    throw new Error(`Node ${nodeId} is not a component or component set`);
  }

  const component = node as ComponentNode | ComponentSetNode;
  component.addComponentProperty(
    payload.name as string,
    payload.type as ComponentPropertyType,
    payload.defaultValue as string | boolean
  );

  return serializeNode(component, 0);
}

/**
 * Edit an existing component property.
 */
export async function executeEditComponentProperty(payload: Record<string, unknown>): Promise<unknown> {
  const nodeId = payload.nodeId as string;
  const node = figma.getNodeById(nodeId);
  if (!node || (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET")) {
    throw new Error(`Node ${nodeId} is not a component or component set`);
  }

  const component = node as ComponentNode | ComponentSetNode;
  const updates: { name?: string; defaultValue?: string | boolean } = {};

  if (payload.name !== undefined) updates.name = payload.name as string;
  if (payload.defaultValue !== undefined) updates.defaultValue = payload.defaultValue as string | boolean;

  component.editComponentProperty(payload.propertyName as string, updates);

  return serializeNode(component, 0);
}

/**
 * Remove a property from a component.
 */
export async function executeDeleteComponentProperty(payload: Record<string, unknown>): Promise<unknown> {
  const nodeId = payload.nodeId as string;
  const node = figma.getNodeById(nodeId);
  if (!node || (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET")) {
    throw new Error(`Node ${nodeId} is not a component or component set`);
  }

  const component = node as ComponentNode | ComponentSetNode;
  component.deleteComponentProperty(payload.propertyName as string);

  return serializeNode(component, 0);
}

/**
 * Set description text on a component, component set, or style.
 */
export async function executeSetDescription(payload: Record<string, unknown>): Promise<unknown> {
  const nodeId = payload.nodeId as string;
  const node = figma.getNodeById(nodeId);
  if (!node) throw new Error(`Node ${nodeId} not found`);

  if ("description" in node) {
    (node as ComponentNode).description = payload.description as string;
  } else {
    throw new Error(`Node ${nodeId} does not support descriptions`);
  }

  return serializeNode(node as SceneNode, 0);
}

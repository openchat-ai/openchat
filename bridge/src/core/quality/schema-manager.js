/**
 * Schema 管理器
 * 包含 Schema 自动生成、版本管理、格式转换功能
 */

export class SchemaAutoGenerator {
  constructor(options = {}) {
    this._strictMode = options.strictMode !== false;
    this._requiredByDefault = options.requiredByDefault !== false;
    this._inferEnums = options.inferEnums !== false;
    this._typeInferenceDepth = options.typeInferenceDepth || 3;
  }

  fromTypeScript(typeString) {
    try {
      const cleaned = this._preprocessTypeScript(typeString);
      const schema = this._parseTypeScript(cleaned);
      return { success: true, schema };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  _preprocessTypeScript(typeString) {
    return typeString
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _parseTypeScript(typeString) {
    const schema = { type: 'object', properties: {}, required: [] };

    const interfaceMatch = typeString.match(/interface\s+\w+\s*\{([^}]*)\}/);
    if (interfaceMatch) {
      const fields = interfaceMatch[1].split(/[;\n]/).filter(f => f.trim());
      for (const field of fields) {
        const parsed = this._parseTypeScriptField(field.trim());
        if (parsed) {
          schema.properties[parsed.name] = parsed.schema;
          if (parsed.required) {
            schema.required.push(parsed.name);
          }
        }
      }
    }

    return schema;
  }

  _parseTypeScriptField(field) {
    const match = field.match(/^(\w+)(\?)?:\s*(.+)$/);
    if (!match) return null;

    const name = match[1];
    const optional = match[2] === '?';
    const typeStr = match[3].trim();

    return {
      name,
      schema: this._parseTypeScriptType(typeStr),
      required: !optional && this._requiredByDefault
    };
  }

  _parseTypeScriptType(typeStr) {
    if (typeStr === 'string') return { type: 'string' };
    if (typeStr === 'number') return { type: 'number' };
    if (typeStr === 'boolean') return { type: 'boolean' };
    if (typeStr === 'string[]') return { type: 'array', items: { type: 'string' } };
    if (typeStr === 'number[]') return { type: 'array', items: { type: 'number' } };

    return { type: 'string' };
  }

  fromExamples(examples) {
    if (!Array.isArray(examples) || examples.length === 0) {
      return { success: false, error: 'No examples provided' };
    }

    const schema = this._inferSchemaFromValue(examples[0]);

    for (let i = 1; i < examples.length && i < this._typeInferenceDepth; i++) {
      this._mergeSchema(schema, this._inferSchemaFromValue(examples[i]));
    }

    return { success: true, schema };
  }

  _inferSchemaFromValue(value) {
    if (value === null) return { type: 'null' };
    if (value === undefined) return { type: 'undefined' };

    const type = Array.isArray(value) ? 'array' : typeof value;

    switch (type) {
      case 'string':
        return this._inferStringSchema(value);
      case 'number':
        return this._inferNumberSchema(value);
      case 'boolean':
        return { type: 'boolean' };
      case 'array':
        return this._inferArraySchema(value);
      case 'object':
        return this._inferObjectSchema(value);
      default:
        return { type: 'string' };
    }
  }

  _inferStringSchema(value) {
    const schema = { type: 'string' };

    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      schema.format = 'date-time';
    } else if (/^[\w.-]+@[\w.-]+\.\w+$/.test(value)) {
      schema.format = 'email';
    } else if (/^https?:\/\//.test(value)) {
      schema.format = 'uri';
    }

    return schema;
  }

  _inferNumberSchema(value) {
    const schema = { type: Number.isInteger(value) ? 'integer' : 'number' };
    return schema;
  }

  _inferArraySchema(value) {
    if (value.length === 0) {
      return { type: 'array', items: {} };
    }

    const itemSchemas = value.map(item => this._inferSchemaFromValue(item));
    const firstItemSchema = itemSchemas[0];
    const allSameType = itemSchemas.every(s => s.type === firstItemSchema.type);

    return {
      type: 'array',
      items: allSameType ? firstItemSchema : { oneOf: itemSchemas }
    };
  }

  _inferObjectSchema(value) {
    const schema = { type: 'object', properties: {}, required: [] };

    for (const [key, val] of Object.entries(value)) {
      schema.properties[key] = this._inferSchemaFromValue(val);
      if (this._requiredByDefault && val !== undefined) {
        schema.required.push(key);
      }
    }

    return schema;
  }

  _mergeSchema(target, source) {
    if (target.type !== source.type) {
      target.type = 'any';
      return;
    }

    if (target.type === 'object' && source.type === 'object') {
      for (const [key, val] of Object.entries(source.properties || {})) {
        if (target.properties[key]) {
          this._mergeSchema(target.properties[key], val);
        } else {
          target.properties[key] = val;
        }
      }

      const targetRequired = new Set(target.required || []);
      const sourceRequired = new Set(source.required || []);
      target.required = [...new Set([...targetRequired, ...sourceRequired])];
    }
  }
}

export class SchemaVersionManager {
  constructor(options = {}) {
    this._versions = new Map();
    this._currentVersion = options.initialVersion || '1.0.0';
    this._history = [];
    this._maxHistory = options.maxHistory || 50;
  }

  register(version, schema) {
    this._versions.set(version, {
      schema,
      registeredAt: Date.now(),
      deprecated: false
    });

    this._history.push({
      action: 'register',
      version,
      timestamp: Date.now()
    });

    this._trimHistory();
  }

  get(version) {
    const entry = this._versions.get(version);
    return entry ? entry.schema : null;
  }

  getCurrent() {
    return this.get(this._currentVersion);
  }

  setCurrent(version) {
    if (!this._versions.has(version)) {
      throw new Error(`Version ${version} not found`);
    }
    this._currentVersion = version;

    this._history.push({
      action: 'setCurrent',
      version,
      timestamp: Date.now()
    });
  }

  deprecate(version) {
    const entry = this._versions.get(version);
    if (entry) {
      entry.deprecated = true;
      this._history.push({
        action: 'deprecate',
        version,
        timestamp: Date.now()
      });
    }
  }

  migrate(data, fromVersion, toVersion = null) {
    const targetVersion = toVersion || this._currentVersion;

    if (!this._versions.has(fromVersion)) {
      throw new Error(`Source version ${fromVersion} not found`);
    }
    if (!this._versions.has(targetVersion)) {
      throw new Error(`Target version ${targetVersion} not found`);
    }

    let currentData = { ...data };
    const versions = this._getVersionPath(fromVersion, targetVersion);

    for (let i = 0; i < versions.length - 1; i++) {
      const current = versions[i];
      const next = versions[i + 1];
      currentData = this._applyMigration(currentData, current, next);
    }

    return currentData;
  }

  _getVersionPath(from, to) {
    const sorted = this._getSortedVersions();

    const fromIndex = sorted.indexOf(from);
    const toIndex = sorted.indexOf(to);

    if (fromIndex === -1 || toIndex === -1) {
      return [from, to];
    }

    if (fromIndex <= toIndex) {
      return sorted.slice(fromIndex, toIndex + 1);
    } else {
      return sorted.slice(toIndex, fromIndex + 1).reverse();
    }
  }

  _getSortedVersions() {
    return Array.from(this._versions.keys()).sort((a, b) => {
      const partsA = a.split('.').map(Number);
      const partsB = b.split('.').map(Number);

      for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
        const valA = partsA[i] || 0;
        const valB = partsB[i] || 0;
        if (valA !== valB) return valA - valB;
      }

      return 0;
    });
  }

  _applyMigration(data, fromVersion, toVersion) {
    // Default migration: just return data
    // Override this method for custom migrations
    return data;
  }

  listVersions() {
    return Array.from(this._versions.entries()).map(([version, entry]) => ({
      version,
      deprecated: entry.deprecated,
      registeredAt: entry.registeredAt
    }));
  }

  rollback(times = 1) {
    const rollbackActions = this._history
      .filter(h => h.action === 'setCurrent')
      .slice(-times - 1, -times);

    if (rollbackActions.length > 0) {
      this._currentVersion = rollbackActions[0].version;
      return true;
    }

    return false;
  }

  _trimHistory() {
    while (this._history.length > this._maxHistory) {
      this._history.shift();
    }
  }
}

export class FormatConverter {
  constructor(options = {}) {
    this._strictMode = options.strictMode !== false;
    this._customConverters = new Map();
    this._registerDefaultConverters();
  }

  _registerDefaultConverters() {
    this.registerConverter('json', 'yaml', this._jsonToYaml.bind(this));
    this.registerConverter('yaml', 'json', this._yamlToJson.bind(this));
    this.registerConverter('json', 'xml', this._jsonToXml.bind(this));
    this.registerConverter('xml', 'json', this._xmlToJson.bind(this));
    this.registerConverter('json', 'csv', this._jsonToCsv.bind(this));
    this.registerConverter('csv', 'json', this._csvToJson.bind(this));
    this.registerConverter('json', 'markdown', this._jsonToMarkdown.bind(this));
  }

  registerConverter(from, to, converter) {
    const key = `${from}:${to}`;
    this._customConverters.set(key, converter);
  }

  convert(data, from, to) {
    const key = `${from}:${to}`;
    const converter = this._customConverters.get(key);

    if (!converter) {
      throw new Error(`No converter found for ${from} to ${to}`);
    }

    return converter(data);
  }

  _jsonToYaml(data, indent = 0) {
    const spaces = '  '.repeat(indent);

    if (data === null || data === undefined) {
      return 'null';
    }

    if (typeof data !== 'object') {
      if (typeof data === 'string') {
        return data.includes('\n') || data.includes(':') || data.includes('#')
          ? `"${data.replace(/"/g, '\\"')}"`
          : data;
      }
      return String(data);
    }

    if (Array.isArray(data)) {
      return data.map(item => `${spaces}- ${this._jsonToYaml(item, indent + 1)}`).join('\n');
    }

    return Object.entries(data)
      .map(([key, value]) => {
        if (typeof value === 'object' && value !== null) {
          return `${key}:\n${spaces}  ${this._jsonToYaml(value, indent + 1)}`;
        }
        return `${key}: ${this._jsonToYaml(value, indent + 1)}`;
      })
      .join('\n');
  }

  _yamlToJson(yaml) {
    // Simplified YAML parser
    const lines = yaml.split('\n');
    const result = {};
    let currentKey = null;
    let currentArray = null;

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('#')) continue;

      if (trimmed.startsWith('- ')) {
        const value = trimmed.slice(2);
        if (currentArray) {
          currentArray.push(this._parseYamlValue(value));
        }
        continue;
      }

      const colonIndex = trimmed.indexOf(':');
      if (colonIndex > 0) {
        const key = trimmed.slice(0, colonIndex).trim();
        const value = trimmed.slice(colonIndex + 1).trim();

        if (value === '') {
          result[key] = {};
          currentKey = key;
          currentArray = null;
        } else {
          result[key] = this._parseYamlValue(value);
          currentArray = null;
        }
      }
    }

    return result;
  }

  _parseYamlValue(value) {
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null') return null;

    if (/^\d+$/.test(value)) return parseInt(value, 10);
    if (/^\d+\.\d+$/.test(value)) return parseFloat(value);

    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }

    return value;
  }

  _jsonToXml(data, rootName = 'root') {
    const toXml = (obj, name) => {
      if (obj === null || obj === undefined) {
        return `<${name}/>`;
      }

      if (typeof obj !== 'object') {
        return `<${name}>${this._escapeXml(String(obj))}</${name}>`;
      }

      if (Array.isArray(obj)) {
        return obj.map(item => toXml(item, name)).join('\n');
      }

      const children = Object.entries(obj)
        .map(([k, v]) => toXml(v, k))
        .join('\n');

      return `<${name}>\n${children}\n</${name}>`;
    };

    return toXml(data, rootName);
  }

  _xmlToJson(xml) {
    // Very simplified XML parser
    const result = {};

    const tagMatch = xml.match(/<(\w+)>([\s\S]*?)<\/\1>/g);
    if (tagMatch) {
      for (const match of tagMatch) {
        const nameMatch = match.match(/<(\w+)>/);
        if (nameMatch) {
          const name = nameMatch[1];
          const content = match.replace(/<\/?\w+>/g, '').trim();
          result[name] = content;
        }
      }
    }

    return result;
  }

  _escapeXml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  _jsonToCsv(data) {
    if (!Array.isArray(data) || data.length === 0) {
      return '';
    }

    const keys = Object.keys(data[0]);
    const header = keys.join(',');

    const rows = data.map(item =>
      keys.map(k => {
        const value = item[k];
        if (value === null || value === undefined) return '';
        if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return String(value);
      }).join(',')
    );

    return [header, ...rows].join('\n');
  }

  _csvToJson(csv) {
    const lines = csv.split('\n');
    if (lines.length < 2) return [];

    const keys = this._parseCsvLine(lines[0]);
    const result = [];

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;

      const values = this._parseCsvLine(lines[i]);
      const obj = {};

      for (let j = 0; j < keys.length; j++) {
        obj[keys[j]] = values[j] || null;
      }

      result.push(obj);
    }

    return result;
  }

  _parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (inQuotes) {
        if (char === '"') {
          if (line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ',') {
          result.push(current);
          current = '';
        } else {
          current += char;
        }
      }
    }

    result.push(current);
    return result;
  }

  _jsonToMarkdown(data) {
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
      return this._jsonToMarkdownTable(data);
    }

    if (typeof data === 'object' && data !== null) {
      return this._jsonToMarkdownObject(data);
    }

    return String(data);
  }

  _jsonToMarkdownObject(data, level = 1) {
    const lines = [];

    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'object' && value !== null) {
        lines.push(`${'#'.repeat(level + 1)} ${key}`);
        lines.push(this._jsonToMarkdownObject(value, level + 1));
      } else {
        lines.push(`- **${key}**: ${value}`);
      }
    }

    return lines.join('\n');
  }

  _jsonToMarkdownTable(json) {
    if (!Array.isArray(json) || json.length === 0) return '';

    const keys = Object.keys(json[0]);

    const headerRow = '| ' + keys.join(' | ') + ' |';
    const separatorRow = '| ' + keys.map(() => '---').join(' | ') + ' |';

    const dataRows = json.map(item => {
      return '| ' + keys.map(k => item[k] ?? '').join(' | ') + ' |';
    });

    return [headerRow, separatorRow, ...dataRows].join('\n');
  }
}

export default SchemaAutoGenerator;

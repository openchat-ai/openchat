package ai.openchat.mobile.agent.core.tools

// === invariants ===
// - Args wraps the raw Map<String, String> passed to Tool.invoke with typed accessors
// - Required-field and type-coercion validation runs at parse time; errors are collected and reported together
// - Defaults apply when a field is absent; explicit empty strings are preserved as-is
// - The raw map is unchanged; Args only provides safe accessors

class Args(val raw: Map<String, String>) {
    fun string(key: String): String? = raw[key].takeIf { it.isNotBlank() }
    fun string(key: String, default: String): String = raw[key]?.takeIf { it.isNotBlank() } ?: default
    fun int(key: String): Int? = raw[key]?.toIntOrNull()
    fun int(key: String, default: Int): Int = raw[key]?.toIntOrNull() ?: default
    fun long(key: String): Long? = raw[key]?.toLongOrNull()
    fun long(key: String, default: Long): Long = raw[key]?.toLongOrNull() ?: default
    fun bool(key: String): Boolean? = raw[key]?.toBooleanStrictOrNull()
    fun bool(key: String, default: Boolean): Boolean = raw[key]?.toBooleanStrictOrNull() ?: default
    fun list(key: String, separator: String = ","): List<String> =
        raw[key]?.splitToSequence(separator)?.filter { it.isNotBlank() }?.toList() ?: emptyList()
}

data class ArgField(
    val name: String,
    val required: Boolean,
    val default: String?,
    val type: ArgType,
    val description: String,
) {
    enum class ArgType { STRING, INT, LONG, BOOLEAN, PATH }
    fun typeLabel(): String = when (type) {
        ArgType.STRING -> "string"
        ArgType.INT -> "int"
        ArgType.LONG -> "long"
        ArgType.BOOLEAN -> "boolean"
        ArgType.PATH -> "path"
    }
    fun schemaFragment(): String = "$name:${typeLabel()}${if (required) "!" else "?"}"
}

object ArgsSchema {
    fun string(name: String, required: Boolean = false, default: String? = null, desc: String = ""): ArgField =
        ArgField(name, required, default, ArgField.ArgType.STRING, desc)
    fun int(name: String, required: Boolean = false, default: Int? = null, desc: String = ""): ArgField =
        ArgField(name, required, default?.toString(), ArgField.ArgType.INT, desc)
    fun long(name: String, required: Boolean = false, default: Long? = null, desc: String = ""): ArgField =
        ArgField(name, required, default?.toString(), ArgField.ArgType.LONG, desc)
    fun bool(name: String, required: Boolean = false, default: Boolean? = null, desc: String = ""): ArgField =
        ArgField(name, required, default?.toString(), ArgField.ArgType.BOOLEAN, desc)
    fun path(name: String, required: Boolean = false, desc: String = ""): ArgField =
        ArgField(name, required, null, ArgField.ArgType.PATH, desc)
}

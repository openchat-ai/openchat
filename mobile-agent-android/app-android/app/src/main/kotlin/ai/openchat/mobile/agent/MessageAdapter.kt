package ai.openchat.mobile.agent

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import android.widget.Toast
import androidx.recyclerview.widget.RecyclerView
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

enum class MessageType {
    USER, AGENT, LOG
}

data class ChatMessage(
    val type: MessageType,
    val content: String,
    val role: String? = null,
    val time: Long = System.currentTimeMillis(),
)

class MessageAdapter(private val messages: List<ChatMessage>) :
    RecyclerView.Adapter<RecyclerView.ViewHolder>() {

    companion object {
        private const val TYPE_USER = 0
        private const val TYPE_AGENT = 1
        private const val TYPE_LOG = 2
    }

    override fun getItemViewType(position: Int): Int {
        return when (messages[position].type) {
            MessageType.USER -> TYPE_USER
            MessageType.AGENT -> TYPE_AGENT
            MessageType.LOG -> TYPE_LOG
        }
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
        val inflater = LayoutInflater.from(parent.context)
        return when (viewType) {
            TYPE_USER -> UserViewHolder(inflater.inflate(R.layout.item_message_user, parent, false))
            TYPE_AGENT -> AgentViewHolder(inflater.inflate(R.layout.item_message_agent, parent, false))
            else -> LogViewHolder(inflater.inflate(R.layout.item_message_log, parent, false))
        }
    }

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        val message = messages[position]
        when (holder) {
            is UserViewHolder -> holder.bind(message)
            is AgentViewHolder -> holder.bind(message)
            is LogViewHolder -> holder.bind(message)
        }
    }

    override fun getItemCount(): Int = messages.size

    class UserViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        private val tvMessage: TextView = view.findViewById(R.id.tvMessage)
        private val tvTime: TextView = view.findViewById(R.id.tvTime)
        fun bind(message: ChatMessage) {
            tvMessage.text = message.content
            tvTime.text = formatTime(message.time)
            itemView.setOnLongClickListener {
                copyToClipboard(itemView.context, message.content)
                true
            }
        }
    }

    class AgentViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        private val tvRole: TextView = view.findViewById(R.id.tvRole)
        private val tvMessage: TextView = view.findViewById(R.id.tvMessage)
        private val tvTime: TextView = view.findViewById(R.id.tvTime)
        fun bind(message: ChatMessage) {
            tvRole.text = message.role ?: "Assistant"
            tvMessage.text = message.content
            tvTime.text = formatTime(message.time)
            itemView.setOnLongClickListener {
                copyToClipboard(itemView.context, message.content)
                true
            }
        }
    }

    class LogViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        private val tvLog: TextView = view.findViewById(R.id.tvLog)
        fun bind(message: ChatMessage) {
            tvLog.text = message.content
        }
    }
}

private val timeFormat = SimpleDateFormat("HH:mm", Locale.getDefault())
private fun formatTime(millis: Long): String = timeFormat.format(Date(millis))

private fun copyToClipboard(context: Context, text: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText(null, text))
    Toast.makeText(context, "Copied", Toast.LENGTH_SHORT).show()
}
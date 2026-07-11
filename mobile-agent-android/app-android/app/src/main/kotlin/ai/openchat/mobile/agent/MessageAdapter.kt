package ai.openchat.mobile.agent

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView

enum class MessageType {
    USER, AGENT, LOG
}

data class ChatMessage(
    val type: MessageType,
    val content: String,
    val role: String? = null
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
        fun bind(message: ChatMessage) {
            tvMessage.text = message.content
        }
    }

    class AgentViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        private val tvRole: TextView = view.findViewById(R.id.tvRole)
        private val tvMessage: TextView = view.findViewById(R.id.tvMessage)
        fun bind(message: ChatMessage) {
            tvRole.text = message.role ?: "Assistant"
            tvMessage.text = message.content
        }
    }

    class LogViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        private val tvLog: TextView = view.findViewById(R.id.tvLog)
        fun bind(message: ChatMessage) {
            tvLog.text = message.content
        }
    }
}
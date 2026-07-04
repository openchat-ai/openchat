package ai.openchat.mobile.agent

import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import ai.openchat.mobile.agent.core.agent.AgentLoop
import ai.openchat.mobile.agent.core.agent.AgentState
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {

    private lateinit var tvStatus: TextView
    private lateinit var tvLog: TextView
    private lateinit var btnStart: Button
    private lateinit var btnApprove: Button
    private lateinit var btnReject: Button

    private val agentLoop = AgentLoop()
    private var loopJob: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        tvStatus = findViewById(R.id.tvStatus)
        tvLog = findViewById(R.id.tvLog)
        btnStart = findViewById(R.id.btnStart)
        btnApprove = findViewById(R.id.btnApprove)
        btnReject = findViewById(R.id.btnReject)

        btnStart.setOnClickListener { toggleAgent() }
        btnApprove.setOnClickListener { agentLoop.approve() }
        btnReject.setOnClickListener { agentLoop.reject() }

        observeState()
    }

    private fun toggleAgent() {
        if (loopJob?.isActive == true) {
            loopJob?.cancel()
        } else {
            loopJob = lifecycleScope.launch { agentLoop.run() }
        }
    }

    private fun observeState() {
        lifecycleScope.launch {
            agentLoop.state.collect { state ->
                updateUi(state)
            }
        }
        lifecycleScope.launch {
            agentLoop.log.collect { entry ->
                tvLog.append("$entry\n")
            }
        }
    }

    private fun updateUi(state: AgentState) {
        tvStatus.text = when (state) {
            AgentState.IDLE -> getString(R.string.label_agent_idle)
            AgentState.RUNNING -> getString(R.string.label_agent_running)
            AgentState.WAITING -> getString(R.string.label_agent_waiting)
        }
        val waiting = state == AgentState.WAITING
        btnApprove.visibility = if (waiting) View.VISIBLE else View.GONE
        btnReject.visibility = if (waiting) View.VISIBLE else View.GONE
        btnStart.text = if (state == AgentState.RUNNING || waiting)
            getString(R.string.action_stop)
        else
            getString(R.string.action_start)
    }
}

package ai.openchat.mobile.agent

import android.os.Bundle
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val textView = TextView(this).apply {
            setText(R.string.app_name)
            textSize = 20f
        }
        setContentView(textView)
    }
}

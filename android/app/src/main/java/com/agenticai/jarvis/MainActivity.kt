package com.agenticai.jarvis

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

/**
 * The app's one screen: the orb, "Sign in with Google", Start/Stop Jarvis, and what you said lately.
 * Signing in opens your browser; when Google is done, the server's page comes back here with jarvis://signed-in.
 */
class MainActivity : Activity() {
    private lateinit var api: Api
    private lateinit var orb: WebView
    private lateinit var status: TextView
    private lateinit var server: EditText
    private lateinit var signIn: Button
    private lateinit var start: Button
    private lateinit var signOut: Button
    private lateinit var recent: TextView
    private val main = Handler(Looper.getMainLooper())
    private var startWhenBack = false // waiting for you to come back from the "display over other apps" setting

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        api = Api(this)
        window.setBackgroundDrawable(ColorDrawable(BACKGROUND))
        setContentView(screen())
        signedIn(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        signedIn(intent)
    }

    override fun onResume() {
        super.onResume()
        if (startWhenBack) {
            startWhenBack = false
            startJarvis() // with or without the floating orb; the notification works either way
        }
        refresh()
        loadRecent()
    }

    override fun onDestroy() {
        orb.destroy()
        super.onDestroy()
    }

    // Signing in ------------------------------------------------------------------

    private fun signIn() {
        api.server = server.text.toString()
        server.setText(api.server)
        if (api.server.isEmpty()) {
            status.text = "First type your Mac's address from ngrok, like https://your-name.ngrok-free.dev"
            return
        }
        status.text = "Checking your Mac..."
        Thread {
            val reachable = api.reachable()
            main.post {
                if (reachable) {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(api.signInUrl(Build.MODEL))))
                } else {
                    status.text = "Can't reach ${api.server}. On your Mac, start the Jarvis server and ngrok, then try again."
                }
            }
        }.start()
    }

    /** The server's page sends us jarvis://signed-in?key=...&email=... after Google sign-in. */
    private fun signedIn(intent: Intent?) {
        val link = intent?.data ?: return
        if (link.scheme != "jarvis" || link.host != "signed-in") return
        val key = link.getQueryParameter("key") ?: return
        api.key = key
        api.email = link.getQueryParameter("email")
        intent.data = null // handled; don't sign in again if the screen is rebuilt
        toast("Signed in as ${api.email}")
        refresh()
        loadRecent()
    }

    private fun signOut() {
        stopService(Intent(this, JarvisService::class.java))
        Thread {
            api.signOut()
            main.post {
                refresh()
                loadRecent()
            }
        }.start()
    }

    // Starting Jarvis ---------------------------------------------------------------

    private fun startOrStop() {
        if (JarvisService.running) {
            stopService(Intent(this, JarvisService::class.java))
            main.postDelayed(::refresh, 300)
            return
        }
        val needed = mutableListOf(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= 33) needed += Manifest.permission.POST_NOTIFICATIONS
        val missing = needed.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) {
            requestPermissions(missing.toTypedArray(), PERMISSIONS)
            return
        }
        allowOrb()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != PERMISSIONS) return
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            allowOrb()
        } else {
            toast("Jarvis needs the microphone to hear you.")
        }
    }

    private fun allowOrb() {
        if (Settings.canDrawOverlays(this)) {
            startJarvis()
            return
        }
        toast("Turn on \"Allow display over other apps\" for Jarvis, then come back.")
        startWhenBack = true
        startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
    }

    private fun startJarvis(action: String? = null) {
        val intent = Intent(this, JarvisService::class.java).setAction(action)
        if (JarvisService.running) startService(intent) else startForegroundService(intent)
        main.postDelayed(::refresh, 300)
    }

    private fun orbTapped() {
        when {
            !api.signedIn -> toast("Sign in with Google first.")
            JarvisService.running -> startJarvis(JarvisService.ACTION_TALK)
            else -> startOrStop()
        }
    }

    // The screen ----------------------------------------------------------------------

    private fun refresh() {
        status.text = if (api.signedIn) "Signed in as ${api.email}" else "Sign in with the Google account whose Gmail Jarvis should use."
        signIn.text = if (api.signedIn) "Sign in again" else "Sign in with Google"
        start.text = if (JarvisService.running) "Stop Jarvis" else "Start Jarvis"
        start.isEnabled = api.signedIn
        signOut.visibility = if (api.signedIn) View.VISIBLE else View.GONE
    }

    private fun loadRecent() {
        if (!api.signedIn) {
            recent.text = ""
            return
        }
        Thread {
            val text = try {
                api.history().take(8).joinToString("\n\n") { "${it.time} on your ${it.device}\nYou: ${it.you}\nJarvis: ${it.jarvis}" }
                    .ifEmpty { "Nothing yet. Tap the orb and ask \"what's new?\"" }
            } catch (e: SignedOut) {
                api.key = null
                "Your sign-in ended. Tap Sign in with Google."
            } catch (e: Exception) {
                "Can't reach your Mac right now."
            }
            main.post {
                recent.text = text
                refresh()
            }
        }.start()
    }

    private fun screen(): View {
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(8), dp(24), dp(32))
        }
        orb = orbWebView(this)
        val orbBox = FrameLayout(this).apply {
            addView(orb, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            addView(View(this@MainActivity).apply { setOnClickListener { orbTapped() } }, // a see-through cover takes the taps
                FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
        column.addView(orbBox, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(240)))
        column.addView(text("Jarvis", 34f, Color.WHITE).apply {
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
        })
        status = text("", 15f, MUTED).apply { gravity = Gravity.CENTER }
        column.addView(status, spaced(8))

        column.addView(text("Your Mac's address", 13f, MUTED), spaced(24))
        server = EditText(this).apply {
            setText(api.server)
            hint = "https://your-name.ngrok-free.dev"
            setHintTextColor(MUTED)
            setSingleLine()
            inputType = InputType.TYPE_TEXT_VARIATION_URI
            setTextColor(Color.WHITE)
        }
        column.addView(server)
        signIn = button("Sign in with Google") { signIn() }
        column.addView(signIn, spaced(8))
        start = button("Start Jarvis") { startOrStop() }
        column.addView(start, spaced(8))
        column.addView(text("Tap the orb to talk: on this screen, floating over other apps, or Talk in the notification. " +
            "Drag the floating orb to move it, and hold it to stop Jarvis.", 14f, MUTED), spaced(12))

        column.addView(text("Recently", 18f, Color.WHITE).apply { typeface = Typeface.DEFAULT_BOLD }, spaced(28))
        recent = text("", 14f, MUTED)
        column.addView(recent, spaced(8))
        signOut = button("Sign out") { signOut() }
        column.addView(signOut, spaced(24))

        return ScrollView(this).apply {
            fitsSystemWindows = true // keep clear of the status bar and the gesture bar
            addView(column)
        }
    }

    private fun text(value: String, size: Float, color: Int) = TextView(this).apply {
        text = value
        textSize = size
        setTextColor(color)
    }

    private fun button(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        setOnClickListener { onClick() }
    }

    private fun spaced(top: Int) = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
    ).apply { topMargin = dp(top) }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_LONG).show()

    companion object {
        private const val PERMISSIONS = 1
        private val BACKGROUND = Color.rgb(5, 6, 15)
        private val MUTED = Color.rgb(170, 172, 190)
    }
}

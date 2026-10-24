package com.agenticai.jarvis

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebView
import android.widget.FrameLayout
import kotlin.math.abs

/** A see-through WebView showing the animated orb from assets/orb.html. */
@SuppressLint("SetJavaScriptEnabled")
fun orbWebView(context: Context): WebView = WebView(context).apply {
    setBackgroundColor(Color.TRANSPARENT)
    settings.javaScriptEnabled = true
    isVerticalScrollBarEnabled = false
    isHorizontalScrollBarEnabled = false
    loadUrl("file:///android_asset/orb.html")
}

/**
 * The floating orb: a small window above your other apps.
 * Tap it to talk, drag it to move it, and hold it for a second to stop Jarvis.
 */
class Orb(private val context: Context, private val onTap: () -> Unit, private val onHold: () -> Unit) {
    private val windows = context.getSystemService(WindowManager::class.java)
    private val prefs = context.getSharedPreferences("jarvis", Context.MODE_PRIVATE)
    private val web = orbWebView(context)
    private val frame = object : FrameLayout(context) {
        override fun onInterceptTouchEvent(event: MotionEvent) = true // the frame handles every touch, not the page
    }
    private val params: WindowManager.LayoutParams
    private var shown = false

    init {
        val metrics = context.resources.displayMetrics
        val size = (110 * metrics.density).toInt()
        params = WindowManager.LayoutParams(
            size, size,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = prefs.getInt("orb_x", metrics.widthPixels - size)
            y = prefs.getInt("orb_y", metrics.heightPixels * 3 / 5)
        }
        frame.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        frame.setOnTouchListener(Touches())
    }

    fun show() {
        if (!shown && Settings.canDrawOverlays(context)) {
            windows.addView(frame, params)
            shown = true
        }
    }

    fun hide() {
        if (shown) {
            windows.removeView(frame)
            shown = false
        }
    }

    /** "idle", "listening", "thinking" or "speaking". */
    fun state(name: String) = web.evaluateJavascript("setState('$name')", null)

    /** How loud you are, 0 to 1, so the orb grows with your voice. */
    fun level(value: Float) = web.evaluateJavascript("setLevel($value)", null)

    fun destroy() {
        hide()
        web.destroy()
    }

    private inner class Touches : View.OnTouchListener {
        private val slop = ViewConfiguration.get(context).scaledTouchSlop
        private val handler = Handler(Looper.getMainLooper())
        private val hold = Runnable { held = true; onHold() }
        private var startX = 0f
        private var startY = 0f
        private var fromX = 0
        private var fromY = 0
        private var moved = false
        private var held = false

        @SuppressLint("ClickableViewAccessibility")
        override fun onTouch(view: View, event: MotionEvent): Boolean {
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    startX = event.rawX
                    startY = event.rawY
                    fromX = params.x
                    fromY = params.y
                    moved = false
                    held = false
                    handler.postDelayed(hold, 900)
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - startX
                    val dy = event.rawY - startY
                    if (!moved && (abs(dx) > slop || abs(dy) > slop)) {
                        moved = true
                        handler.removeCallbacks(hold)
                    }
                    if (moved && shown) {
                        params.x = fromX + dx.toInt()
                        params.y = fromY + dy.toInt()
                        windows.updateViewLayout(frame, params)
                    }
                }
                MotionEvent.ACTION_UP -> {
                    handler.removeCallbacks(hold)
                    if (moved) {
                        prefs.edit().putInt("orb_x", params.x).putInt("orb_y", params.y).apply()
                    } else if (!held) {
                        onTap()
                    }
                }
                MotionEvent.ACTION_CANCEL -> handler.removeCallbacks(hold)
            }
            return true
        }
    }
}

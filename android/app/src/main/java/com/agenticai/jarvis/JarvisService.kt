package com.agenticai.jarvis

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.io.IOException

/**
 * Keeps Jarvis ready while you use other apps: the floating orb, plus a notification with a Talk button.
 *
 * One conversation: listen (Android's speech recognizer turns your voice into text) -> think (your Mac's
 * Jarvis server does the Gmail work) -> speak (Android's text-to-speech) -> listen again for a follow-up,
 * such as "yes" after "Shall I send it?", until you go quiet.
 */
class JarvisService : Service(), RecognitionListener {
    private lateinit var api: Api
    private lateinit var voice: TextToSpeech
    private var voiceReady = false
    private var ears: SpeechRecognizer? = null
    private var orb: Orb? = null
    private val main = Handler(Looper.getMainLooper())
    private var state = "idle" // idle, listening, thinking or speaking
    private var followUp = false // listening for an answer to Jarvis, so silence just ends the conversation

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        api = Api(this)
        getSystemService(NotificationManager::class.java)
            .createNotificationChannel(NotificationChannel(CHANNEL, "Jarvis", NotificationManager.IMPORTANCE_LOW))
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIFICATION, notification(READY), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
            } else {
                startForeground(NOTIFICATION, notification(READY))
            }
        } catch (e: RuntimeException) { // no microphone permission, or Android didn't allow it right now
            stopSelf()
            return
        }
        running = true
        voice = TextToSpeech(this) { status -> voiceReady = status == TextToSpeech.SUCCESS }
        voice.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {}
            override fun onDone(utteranceId: String?) {
                main.post { doneSpeaking(utteranceId) }
            }
            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) {
                main.post { doneSpeaking(utteranceId) }
            }
        })
        orb = Orb(this, onTap = ::tapped, onHold = ::stopSelf).also { it.show() }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!running) return START_NOT_STICKY
        when (intent?.action) {
            ACTION_TALK -> tapped()
            ACTION_STOP -> stopSelf()
            else -> orb?.show() // for example after you allowed "display over other apps"
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        if (running) {
            running = false
            ears?.destroy()
            voice.stop()
            voice.shutdown()
            orb?.destroy()
        }
        super.onDestroy()
    }

    // The conversation -----------------------------------------------------------

    private fun tapped() {
        when (state) {
            "idle" -> {
                followUp = false
                listen()
            }
            "speaking" -> { // interrupt Jarvis and talk
                voice.stop()
                followUp = false
                listen()
            }
            "listening" -> ears?.stopListening() // done talking
            // "thinking": still working on what you said
        }
    }

    private fun listen() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            say("I need the microphone. Open the Jarvis app and allow it.")
            return
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            say("This phone has no speech recognizer. Install or update the Google app, then try again.")
            return
        }
        val recognizer = ears ?: SpeechRecognizer.createSpeechRecognizer(this).also {
            it.setRecognitionListener(this)
            ears = it
        }
        setState("listening")
        recognizer.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, packageName)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        })
    }

    private fun think(text: String) {
        setState("thinking")
        showText("You: $text")
        Thread {
            val (reply, listenAfter) = try {
                val answer = api.talk(text)
                answer.text to (answer.action != "goodbye")
            } catch (e: SignedOut) {
                e.message.orEmpty() to false
            } catch (e: ServerError) {
                e.message.orEmpty() to false
            } catch (e: IOException) {
                "I can't reach your Mac. Check that the Jarvis server and ngrok are running on it." to false
            }
            main.post { speak(reply, listenAfter) }
        }.start()
    }

    private fun speak(text: String, listenAfter: Boolean) {
        followUp = listenAfter
        showText("Jarvis: $text")
        if (!voiceReady || text.isBlank()) {
            if (listenAfter) listen() else setState("idle")
            return
        }
        setState("speaking")
        voice.speak(text, TextToSpeech.QUEUE_FLUSH, null, if (listenAfter) "reply" else "note")
    }

    private fun say(text: String) = speak(text, listenAfter = false)

    private fun doneSpeaking(utteranceId: String?) {
        if (state != "speaking") return // you tapped to interrupt
        if (utteranceId == "reply") listen() else setState("idle")
    }

    private fun setState(name: String) {
        state = name
        orb?.state(name)
    }

    private fun showText(text: String) {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION, notification(text))
    }

    // What the speech recognizer tells us -------------------------------------------

    override fun onResults(results: Bundle?) {
        val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
        if (text.isBlank()) setState("idle") else think(text)
    }

    override fun onError(error: Int) {
        when (error) {
            SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT ->
                if (followUp) setState("idle") else say("I didn't catch that. Tap me and try again.")
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ->
                say("I need the microphone. Open the Jarvis app and allow it.")
            SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT ->
                say("I need the internet to understand you. Check your connection.")
            else -> { // start with a fresh recognizer next time
                ears?.destroy()
                ears = null
                setState("idle")
            }
        }
    }

    override fun onRmsChanged(rmsdB: Float) {
        orb?.level(((rmsdB + 2f) / 12f).coerceIn(0f, 1f))
    }

    override fun onEndOfSpeech() = setState("thinking")
    override fun onReadyForSpeech(params: Bundle?) {}
    override fun onBeginningOfSpeech() {}
    override fun onBufferReceived(buffer: ByteArray?) {}
    override fun onPartialResults(partialResults: Bundle?) {}
    override fun onEvent(eventType: Int, params: Bundle?) {}

    // The notification ---------------------------------------------------------------

    private fun notification(text: String): Notification {
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val talk = PendingIntent.getService(this, 1, Intent(this, JarvisService::class.java).setAction(ACTION_TALK),
            PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 2, Intent(this, JarvisService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_jarvis)
            .setContentTitle("Jarvis")
            .setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setContentIntent(open)
            .setOngoing(true)
            .addAction(Notification.Action.Builder(null as Icon?, "Talk", talk).build())
            .addAction(Notification.Action.Builder(null as Icon?, "Stop", stop).build())
            .build()
    }

    companion object {
        const val ACTION_TALK = "com.agenticai.jarvis.TALK"
        const val ACTION_STOP = "com.agenticai.jarvis.STOP"
        private const val CHANNEL = "jarvis"
        private const val NOTIFICATION = 1
        private const val READY = "Tap the orb or Talk, and ask about your email."

        @Volatile
        var running = false
            private set
    }
}

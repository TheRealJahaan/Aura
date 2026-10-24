package com.agenticai.jarvis

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Talks to the Jarvis server on your Mac, and remembers its address and this phone's key.
 * Every call waits for the network, so call these from a background thread.
 */
class Api(context: Context) {
    private val prefs = context.getSharedPreferences("jarvis", Context.MODE_PRIVATE)

    var server: String
        get() = prefs.getString("server", null) ?: DEFAULT_SERVER
        set(value) = prefs.edit().putString("server", clean(value)).apply()
    var key: String?
        get() = prefs.getString("key", null)
        set(value) = prefs.edit().putString("key", value).apply()
    var email: String?
        get() = prefs.getString("email", null)
        set(value) = prefs.edit().putString("email", value).apply()
    val signedIn: Boolean
        get() = key != null

    fun signInUrl(phone: String) = "$server/login?phone=" + URLEncoder.encode(phone, "UTF-8")

    fun reachable(): Boolean = try {
        request("GET", "/health").optBoolean("ok")
    } catch (e: Exception) {
        false
    }

    /** Sends what you said to Jarvis and returns what Jarvis says back. */
    fun talk(text: String): Reply {
        val json = request("POST", "/api/talk", JSONObject().put("text", text))
        return Reply(json.optString("reply"), json.optString("action"), json.optBoolean("waiting_for_yes"))
    }

    /** The last things you said to Jarvis, on this phone or your Mac, newest first. */
    fun history(): List<Turn> {
        val turns = request("GET", "/api/history").optJSONArray("turns") ?: return emptyList()
        return (0 until turns.length()).map { i ->
            val t = turns.getJSONObject(i)
            Turn(t.optString("time"), t.optString("device"), t.optString("you"), t.optString("jarvis"))
        }
    }

    fun signOut() {
        try {
            request("POST", "/api/signout")
        } catch (e: Exception) {
            // signed out on this phone anyway
        }
        key = null
        email = null
    }

    private fun request(method: String, path: String, body: JSONObject? = null): JSONObject {
        val conn = URL(server + path).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = 15_000
            conn.readTimeout = 240_000 // sorting a whole inbox can take a few minutes on a laptop
            conn.setRequestProperty("ngrok-skip-browser-warning", "1") // skip ngrok's free-plan warning page
            key?.let { conn.setRequestProperty("Authorization", "Bearer $it") }
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(body.toString().toByteArray()) }
            }
            val code = conn.responseCode
            val text = (if (code < 400) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() }
            val json = try {
                JSONObject(text ?: "")
            } catch (e: Exception) {
                JSONObject()
            }
            if (code == 401) throw SignedOut(json.optString("reply", "Please sign in again in the Jarvis app."))
            if (code >= 400) throw ServerError(json.optString("reply", "The Jarvis server on your Mac had a problem ($code)."))
            return json
        } finally {
            conn.disconnect()
        }
    }

    companion object {
        // Empty until you type your Mac's secure link from ngrok on the app's first screen.
        const val DEFAULT_SERVER = ""

        fun clean(address: String): String {
            val trimmed = address.trim().trimEnd('/')
            return if (trimmed.isEmpty()) "" else if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) trimmed else "https://$trimmed"
        }
    }
}

data class Reply(val text: String, val action: String, val waitingForYes: Boolean)

data class Turn(val time: String, val device: String, val you: String, val jarvis: String)

class SignedOut(message: String) : Exception(message)

class ServerError(message: String) : Exception(message)

use reqwest::Client;

/// Search DuckDuckGo Lite for information about a process.
/// Returns a summary string of search results (top 3 snippets).
/// Uses DuckDuckGo Lite (POST, no API key needed, no CAPTCHA).
pub async fn search_process_info(process_name: &str) -> Option<String> {
    let query = format!(
        "{} Windows process what is",
        process_name.trim_end_matches(".exe")
    );

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .ok()?;

    // DuckDuckGo Lite endpoint: POST with form body, returns simple HTML
    let response = match client
        .post("https://lite.duckduckgo.com/lite/")
        .header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        )
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(format!("q={}", urlencoding::encode(&query)))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("  (web search failed: {})", e);
            return None;
        }
    };

    if !response.status().is_success() {
        eprintln!("  (web search HTTP {})", response.status());
        return None;
    }

    let html = match response.text().await {
        Ok(t) => t,
        Err(e) => {
            eprintln!("  (web search read error: {})", e);
            return None;
        }
    };

    // Extract snippets from DuckDuckGo Lite HTML results
    // Lite uses: <td class='result-snippet'>...snippet text...</td>
    let snippets = extract_snippets(&html, 3);

    if snippets.is_empty() {
        // Retry once with simpler query
        let retry_query = process_name.trim_end_matches(".exe").to_string();
        let retry_response = client
            .post("https://lite.duckduckgo.com/lite/")
            .header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            )
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(format!("q={}", urlencoding::encode(&retry_query)))
            .send()
            .await
            .ok()?;

        let retry_html = retry_response.text().await.ok()?;
        let retry_snippets = extract_snippets(&retry_html, 3);

        if retry_snippets.is_empty() {
            None
        } else {
            Some(retry_snippets.join("\n"))
        }
    } else {
        Some(snippets.join("\n"))
    }
}

/// Extract text snippets from DuckDuckGo Lite HTML.
/// Looks for <td class='result-snippet'> elements and extracts their text content.
fn extract_snippets(html: &str, max: usize) -> Vec<String> {
    let mut snippets = Vec::new();
    let marker = "class='result-snippet'>";

    for part in html.split(marker).skip(1) {
        if snippets.len() >= max {
            break;
        }

        // Find the closing </td> tag
        if let Some(end) = part.find("</td>") {
            let raw = &part[..end];
            // Strip HTML tags (bold markers, entities, etc.)
            let clean = strip_html_tags(raw);
            let trimmed = clean.trim().to_string();
            if !trimmed.is_empty() && trimmed.len() > 20 {
                snippets.push(trimmed);
            }
        }
    }

    snippets
}

/// Strip HTML tags and decode common entities from a string.
fn strip_html_tags(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut in_tag = false;

    for ch in input.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => result.push(ch),
            _ => {}
        }
    }

    // Decode common HTML entities
    result
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#x27;", "'")
        .replace("&nbsp;", " ")
}

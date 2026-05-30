use reqwest::Client;

/// Search DuckDuckGo for information about a process.
/// Returns a summary string of search results (top 3 snippets).
/// Uses DuckDuckGo HTML (no API key needed).
pub async fn search_process_info(process_name: &str) -> Option<String> {
    let query = format!(
        "{} Windows process what is",
        process_name.trim_end_matches(".exe")
    );
    let url = format!(
        "https://html.duckduckgo.com/html/?q={}",
        urlencoding::encode(&query)
    );

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .ok()?;

    let response = client
        .get(&url)
        .header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        )
        .send()
        .await
        .ok()?;

    let html = response.text().await.ok()?;

    // Extract snippets from DuckDuckGo HTML results
    let mut snippets = Vec::new();
    for part in html.split("class=\"result__snippet\"") {
        if snippets.len() >= 3 {
            break;
        }
        if let Some(start) = part.find('>') {
            let text = &part[start + 1..];
            if let Some(end) = text.find('<') {
                let snippet = text[..end].trim().to_string();
                if !snippet.is_empty() && snippet.len() > 20 {
                    // Strip HTML tags
                    let clean: String = snippet.replace("<b>", "").replace("</b>", "");
                    snippets.push(clean);
                }
            }
        }
    }

    if snippets.is_empty() {
        None
    } else {
        Some(snippets.join("\n"))
    }
}

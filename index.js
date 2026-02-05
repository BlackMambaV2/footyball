const express = require('express');
const cors = require('cors');
require('dotenv').config();

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

// Configuration spéciale pour Vercel
const chromium = require('@sparticuz/chromium');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'client')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

const TARGET_API_URL = 'https://sortitoutsi.net/api/search-records'; 

// Configuration GitHub pour les images (CDN Gratuit)
const GITHUB_USER = process.env.GITHUB_USER || "BlackMambaV2";
const GITHUB_REPO = process.env.GITHUB_REPO || "footyball";
const GITHUB_RAW_URL = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/main/public`;

let browser;

async function getBrowser() {
    try {
        if (!browser || !browser.isConnected()) {
            const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL;
            
            if (isProd) {
                const executablePath = await chromium.executablePath();
                browser = await puppeteer.launch({
                    args: [...chromium.args, '--hide-scrollbars', '--disable-web-security'],
                    defaultViewport: chromium.defaultViewport,
                    executablePath: executablePath,
                    headless: chromium.headless,
                    ignoreHTTPSErrors: true,
                });
            } else {
                browser = await puppeteer.launch({
                    headless: "new",
                    args: ['--no-sandbox'],
                    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
                });
            }
        }
        return browser;
    } catch (e) {
        console.error('Launch error:', e);
        throw new Error(`Failed to launch browser: ${e.message}`);
    }
}

async function performSearch(searchTerm) {
    let page;
    try {
        const browserInstance = await getBrowser();
        page = await browserInstance.newPage();
        
        // Simulation d'un navigateur humain
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
        
        // Masquer les traces de Puppeteer
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            window.chrome = { runtime: {} };
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
              parameters.name === 'notifications' ?
                Promise.resolve({ state: Notification.permission }) :
                originalQuery(parameters)
            );
        });

        // 1. Aller sur la page de recherche pour obtenir les cookies et le CSRF
        console.log(`Initialisation de la session pour: ${searchTerm}`);
        await page.goto('https://sortitoutsi.net/search', { waitUntil: 'domcontentloaded', timeout: 30000 });

        // 2. Attendre que le token CSRF soit injecté dans le DOM
        await page.waitForSelector('meta[name="csrf-token"]', { timeout: 10000 });

        // 3. Effectuer la requête API depuis le contexte de la page (Crucial pour les cookies/sessions)
        console.log('Appel de l\'API Sortitoutsi...');
        const apiResponse = await page.evaluate(async (url, term) => {
            const token = document.querySelector('meta[name="csrf-token"]')?.content;
            if (!token) throw new Error("CSRF Token missing");

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-TOKEN': token,
                    'X-Requested-With': 'XMLHttpRequest',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ search_term: term })
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`API_ERROR_${response.status}: ${text.substring(0, 100)}`);
            }

            return await response.json();
        }, TARGET_API_URL, searchTerm);

        // 4. Traitement des données (Kits, Visages, etc.)
        if (apiResponse && apiResponse.data) {
            apiResponse.data = apiResponse.data.map(item => {
                let teamFmId = null;
                if (item.type_id === 'team' || item.classification_id === 'team') {
                    teamFmId = item.fm_id; 
                } else if (item.team_icon_url) {
                    const match = item.team_icon_url.match(/\/(\d+)\.png/);
                    if (match) teamFmId = match[1];
                }

                if (item.type_id === 'person' && item.fm_id) {
                    item.local_face_url = `${GITHUB_RAW_URL}/faces/${item.fm_id}.png`;
                }

                if (teamFmId) {
                    item.team_fm_id = teamFmId;
                    item.local_kits = {
                        home: `${GITHUB_RAW_URL}/kits/${teamFmId}_home.png`,
                        away: `${GITHUB_RAW_URL}/kits/${teamFmId}_away.png`,
                        third: `${GITHUB_RAW_URL}/kits/${teamFmId}_third.png`
                    };
                }
                
                return item;
            });
        }

        return apiResponse;
    } catch (error) {
        console.error('API Simulation Error:', error.message);
        throw error;
    } finally {
        if (page) await page.close();
    }
}

app.post('/api/search', async (req, res) => {
    try {
        const { search_term } = req.body;
        const results = await performSearch(search_term);
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Routes de compatibilité
app.get('/api/search/:name', async (req, res) => {
    try {
        const results = await performSearch(req.params.name);
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/team/:name', async (req, res) => {
    try {
        const results = await performSearch(req.params.name);
        if (results && results.data) {
            results.data = results.data.filter(item => item.type_id === 'team');
        }
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`Serveur local : http://localhost:${PORT}`));
}

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

const TARGET_API_URL = 'https://sortitoutsi.net/api/search-records'; 

// Configuration GitHub pour les images (CDN Gratuit)
const GITHUB_USER = process.env.GITHUB_USER || "BlackMambaV2";
const GITHUB_REPO = process.env.GITHUB_REPO || "footyball";
const GITHUB_RAW_URL = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/main/public`;

let browser;

async function getBrowser() {
    if (!browser || !browser.isConnected()) {
        const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL;
        
        if (isProd) {
            // Configuration pour VERCEL
            browser = await puppeteer.launch({
                args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
                defaultViewport: chromium.defaultViewport,
                executablePath: await chromium.executablePath(),
                headless: chromium.headless,
                ignoreHTTPSErrors: true,
            });
        } else {
            // Configuration pour LOCAL
            browser = await puppeteer.launch({
                headless: "new",
                args: ['--no-sandbox'],
                executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
            });
        }
    }
    return browser;
}

async function performSearch(searchTerm) {
    let page;
    try {
        const browserInstance = await getBrowser();
        page = await browserInstance.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');
        
        await page.goto('https://sortitoutsi.net/search', { waitUntil: 'domcontentloaded', timeout: 60000 });

        const apiResponse = await page.evaluate(async (url, term) => {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]')?.content || '',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify({ search_term: term })
            });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.json();
        }, TARGET_API_URL, searchTerm);

        if (apiResponse && apiResponse.data) {
            const ALLOWED_FIELDS = [
                "id", "fm_id", "gender", "type_id", "classification_id", "name", "slug",
                "continent_id", "nation_id", "contracted_nation_id", "division_id", "team_id",
                "icon_url", "logo_url", "flag_url", "team_icon_url", "nation_icon_url",
                "detail_name", "local_kits", "team_fm_id", "external_kits_info", "local_face_url"
            ];

            apiResponse.data = apiResponse.data.map(item => {
                let teamFmId = null;
                if (item.type_id === 'team' || item.classification_id === 'team') {
                    teamFmId = item.fm_id; 
                } else if (item.team_icon_url) {
                    const match = item.team_icon_url.match(/\/(\d+)\.png/);
                    if (match) teamFmId = match[1];
                }

                if (item.type_id === 'person' && item.fm_id) {
                    // En local on vérifie si le fichier existe, en prod on fait confiance à GitHub
                    const localFacePath = path.join(__dirname, 'public', 'faces', `${item.fm_id}.png`);
                    if (process.env.NODE_ENV !== 'production') {
                        if (fs.existsSync(localFacePath)) {
                            item.local_face_url = `http://localhost:${PORT}/images/faces/${item.fm_id}.png`;
                        }
                    } else {
                        item.local_face_url = `${GITHUB_RAW_URL}/faces/${item.fm_id}.png`;
                    }
                }

                if (teamFmId) {
                    const kitTypes = ['home', 'away', 'third'];
                    item.local_kits = {};
                    item.team_fm_id = teamFmId;
                    item.external_kits_info = `https://sortitoutsi.net/team/${teamFmId}/kits`;
                    
                    kitTypes.forEach(type => {
                        const fileName = `${teamFmId}_${type}.png`;
                        if (process.env.NODE_ENV !== 'production') {
                            const localKitPath = path.join(__dirname, 'public', 'kits', fileName);
                            if (fs.existsSync(localKitPath)) {
                                item.local_kits[type] = `http://localhost:${PORT}/images/kits/${fileName}`;
                            }
                        } else {
                            item.local_kits[type] = `${GITHUB_RAW_URL}/kits/${fileName}`;
                        }
                    });
                }
                
                return Object.keys(item)
                    .filter(key => ALLOWED_FIELDS.includes(key))
                    .reduce((obj, key) => { obj[key] = item[key]; return obj; }, {});
            });
        }
        return apiResponse;
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

// Export pour Vercel
module.exports = app;

// Démarrage local
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`Serveur local : http://localhost:${PORT}`));
}

import cds from '@sap/cds';
import axios from 'axios';

let cachedToken = null;
let tokenExpiry = 0;

// Reads credentials from the bound user-provided service in production,
// falls back to .env locally for development
function getTamConfig() {
    const creds = cds.env.requires?.['tam-credentials']?.credentials;
    if (creds) {
        return creds;
    }
    return {
        TAM_TOKEN_URL: process.env.TAM_TOKEN_URL,
        TAM_CLIENT_AUTH: process.env.TAM_CLIENT_AUTH,
        TAM_SEARCH_URL: process.env.TAM_SEARCH_URL,
        TAM_USERNAME: process.env.TAM_USERNAME,
        TAM_PASSWORD: process.env.TAM_PASSWORD
    };
}

async function getAccessToken() {
    const now = Date.now();
    if (cachedToken && now < tokenExpiry) {
        return cachedToken;
    }

    const config = getTamConfig();
    const params = new URLSearchParams();
    params.append('grant_type', 'password');
    params.append('username', config.TAM_USERNAME);
    params.append('password', config.TAM_PASSWORD);

    const response = await axios.post(
        config.TAM_TOKEN_URL,
        params.toString(),
        {
            headers: {
                'Authorization': `Basic ${config.TAM_CLIENT_AUTH}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }
    );

    cachedToken = response.data.access_token;
    tokenExpiry = now + (response.data.expires_in - 30) * 1000;

    return cachedToken;
}

async function searchRecord(token, searchText) {
    const config = getTamConfig();
    const response = await axios.get(config.TAM_SEARCH_URL, {
        headers: { 'Authorization': `Bearer ${token}` },
        params: { text: searchText }
    });
    return response.data;
}

export default cds.service.impl(async function () {

    this.on('checkDuplicates', async (req) => {
        const { records } = req.data;

        let token;
        try {
            token = await getAccessToken();
        } catch (err) {
            console.error('TOKEN FETCH FAILED:', err.message);
            req.error(500, 'Failed to authenticate with TAM: ' + err.message);
            return;
        }

        const results = [];

        for (const record of records) {
            try {
                const searchResult = await searchRecord(token, record.materialNumber);
                const materials = searchResult.materials || [];

                if (materials.length === 0) {
                    results.push({
                        rowNo: record.rowNo,
                        materialDesc: record.materialDescription,
                        mpn: record.materialNumber,
                        status: 'New',
                        matchedMaterialNo: '',
                        matchedMaterialDesc: '',
                        matchedLongDesc: ''
                    });
                } else {
                    for (const match of materials) {
                        results.push({
                            rowNo: record.rowNo,
                            materialDesc: record.materialDescription,
                            mpn: record.materialNumber,
                            status: 'Duplicate',
                            matchedMaterialNo: match.materialCode || '',
                            matchedMaterialDesc: match.description || '',
                            matchedLongDesc: match.longDescription || ''
                        });
                    }
                }
            } catch (err) {
                console.error(`Error checking record ${record.rowNo}:`, err.message);
                results.push({
                    rowNo: record.rowNo,
                    materialDesc: record.materialDescription,
                    mpn: record.materialNumber,
                    status: 'Error',
                    matchedMaterialNo: '',
                    matchedMaterialDesc: '',
                    matchedLongDesc: ''
                });
            }
        }

        return results;
    });

});
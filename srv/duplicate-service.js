import cds from '@sap/cds';
import 'dotenv/config';
import axios from 'axios';

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
    const now = Date.now();
    if (cachedToken && now < tokenExpiry) {
        return cachedToken;
    }

    const params = new URLSearchParams();
    params.append('grant_type', 'password');
    params.append('username', process.env.TAM_USERNAME);
    params.append('password', process.env.TAM_PASSWORD);

    const response = await axios.post(
        process.env.TAM_TOKEN_URL,
        params.toString(),
        {
            headers: {
                'Authorization': `Basic ${process.env.TAM_CLIENT_AUTH}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }
    );

    cachedToken = response.data.access_token;
    tokenExpiry = now + (response.data.expires_in - 30) * 1000;

    return cachedToken;
}

async function searchRecord(token, searchText) {
    const response = await axios.get(process.env.TAM_SEARCH_URL, {
        headers: { 'Authorization': `Bearer ${token}` },
        params: { text: searchText }
    });
    return response.data;
}

// MPN is not a dedicated field in TAM's response - it appears embedded as free text
// inside description/longDescription, e.g. "...(Alt P/N 59044P080055 & ...)...".
// So we match by checking whether the MPN appears as a substring in those fields.
const MAX_MATCHES = 20;

function findAllMatches(materials, mpn) {
    if (!materials || materials.length === 0) return [];

    const normalizedMpn = mpn.trim().toLowerCase();
    const seen = new Set();
    const matches = [];

    for (const m of materials) {
        if (seen.has(m.materialCode)) continue;

        const desc = (m.description || '').toLowerCase();
        const longDesc = (m.longDescription || '').toLowerCase();
        const shortDescEn = (m.shortDescriptions?.en || '').toLowerCase();
        const longDescEn = (m.longDescriptions?.en || '').toLowerCase();

        if (
            desc.includes(normalizedMpn) ||
            longDesc.includes(normalizedMpn) ||
            shortDescEn.includes(normalizedMpn) ||
            longDescEn.includes(normalizedMpn)
        ) {
            matches.push(m);
            seen.add(m.materialCode);
        }
    }

    return matches.slice(0, MAX_MATCHES);
}

export default cds.service.impl(async function () {

    this.on('checkDuplicates', async (req) => {
        const { records } = req.data;

        let token;
        try {
            token = await getAccessToken();
        } catch (err) {
            console.error('TOKEN FETCH FAILED:', err.message);
            if (err.response) {
                console.error('Status:', err.response.status);
                console.error('Data:', JSON.stringify(err.response.data));
            }
            req.error(500, 'Failed to authenticate with TAM: ' + err.message);
            return;
        }

        const results = [];

        for (const record of records) {
            try {
                const searchResult = await searchRecord(token, record.materialNumber);
                const materials = searchResult.materials || [];

                const matches = findAllMatches(materials, record.materialNumber);

                if (matches.length === 0) {
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
    for (const match of matches) {
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
                if (err.response) {
                    console.error('Status:', err.response.status);
                    console.error('Data:', JSON.stringify(err.response.data));
                }
                results.push({
                    rowNo: record.rowNo,
                    materialDesc: record.materialDescription,
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
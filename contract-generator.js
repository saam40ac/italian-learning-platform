/**
 * contract-generator.js
 * Genera il PDF del Contratto di Affiliazione pre-compilato con i dati del centro.
 * Dipendenza: pdfkit (npm install pdfkit)
 *
 * Utilizzo:
 *   const { generateContractPDF } = require('./contract-generator');
 *   const pdfBuffer = await generateContractPDF(affiliateData);
 */

const PDFDocument = require('pdfkit');

// ─── COSTANTI CONCEDENTE ───────────────────────────────────────────
const CONCEDENTE = {
    ragioneSociale: 'SAAM 4.0 Academy School',
    projectManager: 'Angelo Pagliara',
    sede:           'Via Dott. Cosimo Argentieri, 24 — 72022 Latiano (BR) — Italia',
    piva:           '02490040744',
    email:          'training@angelopagliara.it',
    pec:            'angelopagliara@mypec.eu',
    siti:           'www.angelopagliara.it — www.saam40.net',
};

// ─── COLORI ────────────────────────────────────────────────────────
const VERDE   = '#009246';
const ROSSO   = '#CE2B37';
const NERO    = '#1A1A1A';
const GRIGIO  = '#4A4A4A';
const GRIGIO2 = '#7A7A7A';
const LGREY   = '#E8EDE8';
const BIANCO  = '#FFFFFF';
const ORO     = '#C8900A';

// ─── HELPERS ───────────────────────────────────────────────────────
function today() {
    return new Date().toLocaleDateString('it-IT', { day:'2-digit', month:'2-digit', year:'numeric' });
}
function yearFromNow() {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toLocaleDateString('it-IT', { day:'2-digit', month:'2-digit', year:'numeric' });
}
function contractNumber(id) {
    const year = new Date().getFullYear();
    return `${String(id).padStart(3,'0')} / ${year}`;
}
function extractPlan(notes) {
    if (!notes) return null;
    const m = notes.match(/PIANO SCELTO:\s*(Piano\s+\w+)/i);
    return m ? m[1] : null;
}
function isPremium(notes) {
    return notes && notes.toLowerCase().includes('premium');
}

// ─── GENERATORE PRINCIPALE ─────────────────────────────────────────
function generateContractPDF(affiliate) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size: 'A4',
            margins: { top: 50, bottom: 50, left: 60, right: 60 },
            info: {
                Title: `Contratto Affiliazione — ${affiliate.organization_name}`,
                Author: 'SAAM 4.0 Academy School',
                Subject: 'Contratto di Affiliazione',
                Creator: 'Saam 4.0 Platform',
            }
        });

        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const pageW = doc.page.width;
        const pageH = doc.page.height;
        const marginL = 60;
        const marginR = 60;
        const contentW = pageW - marginL - marginR;
        const premium = isPremium(affiliate.notes);
        const piano = extractPlan(affiliate.notes);
        const commRate = affiliate.commission_rate || (premium ? 30 : 20);
        const quotaAnnuale = premium ? '€ 197,00' : '€ 97,00';

        // ══════════════════════════════════════════════
        // COPERTINA
        // ══════════════════════════════════════════════

        // Fascia verde superiore
        doc.rect(0, 0, pageW, 8).fill(VERDE);
        // Fascia rossa
        doc.rect(0, 8, pageW, 4).fill(ROSSO);

        // Titolo principale
        doc.moveDown(3);
        doc.font('Helvetica-Bold').fontSize(22).fillColor(VERDE)
           .text('SAAM 4.0 ACADEMY SCHOOL', marginL, 80, { align: 'center', width: contentW });

        doc.font('Helvetica').fontSize(10).fillColor(GRIGIO2)
           .text('Piattaforma AI di Apprendimento della Lingua Italiana', marginL, 108, { align: 'center', width: contentW });

        // Linea decorativa tricolore
        const lx = marginL;
        const ly = 128;
        const lw = contentW / 3;
        doc.rect(lx, ly, lw, 3).fill(VERDE);
        doc.rect(lx + lw, ly, lw, 3).fill(BIANCO).strokeColor('#CCCCCC').lineWidth(0.5).stroke();
        doc.rect(lx + lw * 2, ly, lw, 3).fill(ROSSO);

        // Titolo contratto
        doc.font('Helvetica-Bold').fontSize(28).fillColor(NERO)
           .text('CONTRATTO DI AFFILIAZIONE', marginL, 152, { align: 'center', width: contentW });

        doc.font('Helvetica').fontSize(11).fillColor(GRIGIO)
           .text('Accordo di Partnership — Programma Centri Accreditati', marginL, 188, { align: 'center', width: contentW });

        // Box dati contratto
        const boxY = 220;
        const boxH = 130;
        doc.roundedRect(marginL, boxY, contentW, boxH, 8)
           .fillAndStroke('#F5F9F5', VERDE);

        doc.font('Helvetica-Bold').fontSize(9).fillColor(GRIGIO2)
           .text('N. CONTRATTO', marginL + 20, boxY + 16);
        doc.font('Helvetica-Bold').fontSize(14).fillColor(NERO)
           .text(contractNumber(affiliate.id), marginL + 20, boxY + 28);

        doc.font('Helvetica-Bold').fontSize(9).fillColor(GRIGIO2)
           .text('DATA STIPULA', marginL + 20, boxY + 60);
        doc.font('Helvetica').fontSize(12).fillColor(NERO)
           .text(today(), marginL + 20, boxY + 72);

        doc.font('Helvetica-Bold').fontSize(9).fillColor(GRIGIO2)
           .text('DURATA', marginL + 20, boxY + 98);
        doc.font('Helvetica').fontSize(10).fillColor(NERO)
           .text(`12 mesi — dal ${today()} al ${yearFromNow()}`, marginL + 20, boxY + 110);

        // Piano badge (destra del box)
        const badgeX = marginL + contentW - 180;
        const badgeColor = premium ? VERDE : ORO;
        const badgeFill = premium ? '#D1F0DC' : '#FFF3CD';
        doc.roundedRect(badgeX, boxY + 20, 160, 90, 8)
           .fillAndStroke(badgeFill, badgeColor);
        doc.font('Helvetica-Bold').fontSize(8).fillColor(GRIGIO2)
           .text('PIANO SCELTO', badgeX, boxY + 28, { align: 'center', width: 160 });
        doc.font('Helvetica-Bold').fontSize(16).fillColor(badgeColor)
           .text(premium ? 'PREMIUM' : 'STANDARD', badgeX, boxY + 44, { align: 'center', width: 160 });
        doc.font('Helvetica-Bold').fontSize(13).fillColor(badgeColor)
           .text(quotaAnnuale + '/anno', badgeX, boxY + 68, { align: 'center', width: 160 });
        doc.font('Helvetica').fontSize(10).fillColor(GRIGIO)
           .text(`Commissioni ${commRate}%`, badgeX, boxY + 88, { align: 'center', width: 160 });

        // Nota BOZZA
        doc.font('Helvetica-Oblique').fontSize(8).fillColor('#CCCCCC')
           .text('Documento generato automaticamente dalla piattaforma — Verificare prima della firma', marginL, boxY + boxH + 15, { align: 'center', width: contentW });

        // Fascia footer copertina
        doc.rect(0, pageH - 40, pageW, 40).fill('#F5F9F5');
        doc.rect(0, pageH - 40, pageW, 1).fill(VERDE);
        doc.font('Helvetica').fontSize(8).fillColor(GRIGIO2)
           .text('www.angelopagliara.it — training@angelopagliara.it — angelopagliara@mypec.eu', 0, pageH - 25, { align: 'center', width: pageW });

        // ══════════════════════════════════════════════
        // PAGINA 2 — PARTI CONTRAENTI
        // ══════════════════════════════════════════════
        doc.addPage();
        _header(doc, pageW, VERDE, ROSSO, marginL, contentW, `Contratto N. ${contractNumber(affiliate.id)} — ${affiliate.organization_name}`);

        _heading1(doc, '1. PARTI CONTRAENTI', marginL, contentW, VERDE, NERO);

        _heading2(doc, 'IL CONCEDENTE', doc.y, marginL, VERDE);
        _infoTable(doc, [
            ['Ragione Sociale', `${CONCEDENTE.ragioneSociale} (P.M.: ${CONCEDENTE.projectManager})`],
            ['Sede Legale',    CONCEDENTE.sede],
            ['P.IVA / C.F.',  CONCEDENTE.piva],
            ['Email',         CONCEDENTE.email],
            ['PEC',           CONCEDENTE.pec],
            ['Siti Web',      CONCEDENTE.siti],
        ], marginL, contentW, doc);

        doc.moveDown(0.8);
        _heading2(doc, 'IL CENTRO AFFILIATO', doc.y, marginL, VERDE);
        _infoTable(doc, [
            ['Ragione Sociale',    affiliate.organization_name || '—'],
            ['Forma Giuridica',    '___________________________'],
            ['Sede Legale',        `${affiliate.address || '___'} — ${affiliate.city || '___'}`],
            ['P.IVA / C.F.',       affiliate.vat_number || '___________________________'],
            ['Referente',          affiliate.contact_name || '—'],
            ['Email Istituzionale',affiliate.email || '—'],
            ['PEC',                affiliate.pec || '___________________________'],
            ['Codice SDI',         affiliate.codice_sdi || '___________________________'],
            ['Telefono',           affiliate.phone || '___________________________'],
            ['IBAN (pagamenti)',    '___________________________'],
        ], marginL, contentW, doc);

        doc.moveDown(0.5);
        doc.font('Helvetica-Oblique').fontSize(9).fillColor(GRIGIO2)
           .text('Le parti come sopra identificate convengono e stipulano quanto segue.', marginL, doc.y, { width: contentW, align: 'center' });

        _footer(doc, pageW, pageH, marginL, VERDE);

        // ══════════════════════════════════════════════
        // PAGINA 3 — ART. 1-5
        // ══════════════════════════════════════════════
        doc.addPage();
        _header(doc, pageW, VERDE, ROSSO, marginL, contentW, `Contratto N. ${contractNumber(affiliate.id)} — ${affiliate.organization_name}`);

        _article(doc, 2, 'Oggetto del Contratto', marginL, contentW, VERDE, NERO);
        _body(doc,
            'Il presente Contratto disciplina i termini e le condizioni dell\'affiliazione del Centro al Programma Partner di SAAM 4.0 Academy School, piattaforma AI di apprendimento della lingua italiana. Il Centro acquisisce il diritto non esclusivo di promuovere, distribuire e gestire l\'accesso dei propri studenti alla Piattaforma, in cambio di una commissione sulle sottoscrizioni generate tramite il proprio codice univoco.',
            marginL, contentW, doc);

        _article(doc, 3, 'Piani di Abbonamento e Struttura Commissioni', marginL, contentW, VERDE, NERO);
        _body(doc, 'Gli studenti iscritti tramite il Centro accedono alla Piattaforma attraverso i seguenti piani mensili:', marginL, contentW, doc);
        _planTable(doc, marginL, contentW, commRate, premium);

        _article(doc, 4, 'Quota Annuale di Adesione', marginL, contentW, VERDE, NERO);
        _body(doc,
            `Il Centro corrisponde al Concedente una Quota Annuale di Adesione di ${quotaAnnuale} (piano ${premium?'Premium':'Standard'}), con commissioni al ${commRate}%. La quota è dovuta al momento dell'approvazione e successivamente con cadenza annuale entro 30 giorni dalla data anniversario. Il mancato pagamento entro 15 giorni dalla scadenza comporta la sospensione dell'accesso alla Dashboard Partner. La quota non è rimborsabile.`,
            marginL, contentW, doc);

        _article(doc, 5, 'Codice di Affiliazione e Tracciamento', marginL, contentW, VERDE, NERO);
        _body(doc,
            `Al Centro viene assegnato il Codice Univoco: `,
            marginL, contentW, doc, false);
        doc.font('Helvetica-Bold').fontSize(11).fillColor(VERDE)
           .text(affiliate.referral_code || 'SAAM-XXXXX', { continued: false });
        _body(doc, 'Tale codice è personale, non cedibile, accessibile dalla Dashboard Partner e utilizzabile nella pagina di registrazione pubblica tramite il parametro ?ref=CODICE.', marginL, contentW, doc);

        _article(doc, 6, 'Pagamento delle Provvigioni', marginL, contentW, VERDE, NERO);
        _body(doc,
            `Le provvigioni (${commRate}% sul canone mensile netto per studente attivo) sono calcolate il giorno 5 del mese successivo e liquidate entro il giorno 15 mediante bonifico bancario all'IBAN comunicato dal Centro. Non sono corrisposte provvigioni su abbonamenti in prova, oggetto di chargeback o rimborso.`,
            marginL, contentW, doc);

        _footer(doc, pageW, pageH, marginL, VERDE);

        // ══════════════════════════════════════════════
        // PAGINA 4 — ART. 6-12
        // ══════════════════════════════════════════════
        doc.addPage();
        _header(doc, pageW, VERDE, ROSSO, marginL, contentW, `Contratto N. ${contractNumber(affiliate.id)} — ${affiliate.organization_name}`);

        _article(doc, 7, 'Account di Prova (Trial)', marginL, contentW, VERDE, NERO);
        _body(doc, 'Il Centro ha diritto ad attivare 1 account di prova settimanale (durata 7 giorni, limite 30 minuti, senza commissioni), tramite la Dashboard Partner. L\'abuso sistematico di questa funzionalità comporta la revoca del diritto.', marginL, contentW, doc);

        _article(doc, 8, 'Dashboard Partner', marginL, contentW, VERDE, NERO);
        _body(doc, 'Il Concedente mette a disposizione una Dashboard Partner con: panoramica studenti attivi, MRR e commissioni maturate, monitoraggio minuti, reportistica mensile, attivazione account di prova e proiezione ricavi. Le credenziali sono comunicate all\'approvazione.', marginL, contentW, doc);

        _article(doc, 9, 'Obblighi del Centro Affiliato', marginL, contentW, VERDE, NERO);
        _body(doc, 'Il Centro si impegna a: promuovere la Piattaforma con correttezza; non cedere il codice a terzi; non registrare studenti fittizi; comunicare tempestivamente variazioni di IBAN o dati aziendali; rispettare il GDPR; non promuovere concorrenti diretti con materiali del Concedente.', marginL, contentW, doc);

        _article(doc, 10, 'Obblighi del Concedente', marginL, contentW, VERDE, NERO);
        _body(doc, 'Il Concedente garantisce: SLA minimo 99% mensile; aggiornamenti della Piattaforma senza costi aggiuntivi; preavviso di 30 giorni per variazioni tariffarie; supporto tecnico via email entro 48 ore lavorative; trasmissione mensile del riepilogo commissioni.', marginL, contentW, doc);

        _article(doc, 11, 'Durata, Rinnovo e Recesso', marginL, contentW, VERDE, NERO);
        _body(doc,
            `Il Contratto ha durata di 12 mesi (dal ${today()} al ${yearFromNow()}) con rinnovo automatico annuale, salvo disdetta scritta con 30 giorni di preavviso. Il recesso non dà diritto al rimborso della quota residua. Il Concedente può risolvere immediatamente per: frode, violazione grave degli obblighi, mancato pagamento oltre 15 giorni dalla scadenza.`,
            marginL, contentW, doc);

        _article(doc, 12, 'Proprietà Intellettuale e Riservatezza', marginL, contentW, VERDE, NERO);
        _body(doc, 'Tutti i contenuti della Piattaforma sono di proprietà esclusiva del Concedente. Le parti si obbligano alla riservatezza su tutte le informazioni commerciali e tecniche per tutta la durata del contratto e per i 3 anni successivi alla cessazione.', marginL, contentW, doc);

        _article(doc, 13, 'GDPR e Protezione dei Dati', marginL, contentW, VERDE, NERO);
        _body(doc, 'Il trattamento dei dati personali avviene nel rispetto del Regolamento UE 2016/679 (GDPR). Le parti sottoscriveranno, ove necessario, apposito Accordo di Responsabilità del Trattamento (DPA) ai sensi dell\'Art. 28 GDPR.', marginL, contentW, doc);

        _article(doc, 14, 'Foro Competente e Legge Applicabile', marginL, contentW, VERDE, NERO);
        _body(doc, 'Il Contratto è regolato dalla legge italiana. Le parti tenteranno in primo luogo una risoluzione amichevole entro 30 giorni. In mancanza di accordo, il Foro esclusivamente competente è quello di Brindisi (BR).', marginL, contentW, doc);

        _footer(doc, pageW, pageH, marginL, VERDE);

        // ══════════════════════════════════════════════
        // PAGINA 5 — FIRME
        // ══════════════════════════════════════════════
        doc.addPage();
        _header(doc, pageW, VERDE, ROSSO, marginL, contentW, `Contratto N. ${contractNumber(affiliate.id)} — ${affiliate.organization_name}`);

        _heading1(doc, 'DICHIARAZIONI FINALI E FIRME', marginL, contentW, VERDE, NERO);

        doc.font('Helvetica').fontSize(10).fillColor(GRIGIO)
           .text(
               'Le parti dichiarano di aver letto, compreso e accettato integralmente il presente Contratto. Le seguenti clausole sono specificamente approvate ai sensi degli artt. 1341 e 1342 c.c.:',
               marginL, doc.y + 8, { width: contentW, align: 'justified', lineGap: 3 }
           );
        doc.moveDown(0.5);
        const clausole = [
            'Art. 11 — Risoluzione immediata per inadempimento del Centro',
            'Art. 12 — Riservatezza triennale post-contratto',
            'Art. 13 — Limitazione di responsabilità del Concedente',
            'Art. 14 — Clausola di proroga della competenza del Foro (Brindisi BR)',
        ];
        clausole.forEach(c => {
            doc.font('Helvetica').fontSize(9).fillColor(GRIGIO)
               .text(`• ${c}`, marginL + 20, doc.y + 4, { width: contentW - 20 });
        });

        doc.moveDown(1.2);
        // Luogo e data
        doc.font('Helvetica-Bold').fontSize(10).fillColor(NERO)
           .text('Luogo: ', marginL, doc.y, { continued: true });
        doc.font('Helvetica').fillColor(GRIGIO)
           .text('_______________________________     ', { continued: true });
        doc.font('Helvetica-Bold').fillColor(NERO)
           .text('Data: ', { continued: true });
        doc.font('Helvetica').fillColor(GRIGIO)
           .text(today());

        doc.moveDown(2);

        // Blocchi firma
        const sigY = doc.y;
        const halfW = (contentW - 40) / 2;

        // Sinistra — Concedente
        doc.roundedRect(marginL, sigY, halfW, 110, 6)
           .fillAndStroke('#F5F9F5', VERDE);
        doc.font('Helvetica-Bold').fontSize(9).fillColor(VERDE)
           .text('PER IL CONCEDENTE', marginL, sigY + 12, { align: 'center', width: halfW });
        doc.font('Helvetica').fontSize(9).fillColor(GRIGIO)
           .text('SAAM 4.0 Academy School', marginL, sigY + 26, { align: 'center', width: halfW });
        doc.font('Helvetica-Oblique').fontSize(8).fillColor(GRIGIO2)
           .text('Angelo Pagliara — Project Manager', marginL, sigY + 40, { align: 'center', width: halfW });
        doc.moveTo(marginL + 20, sigY + 90).lineTo(marginL + halfW - 20, sigY + 90)
           .lineWidth(1).strokeColor(VERDE).stroke();
        doc.font('Helvetica-Oblique').fontSize(8).fillColor(GRIGIO2)
           .text('Firma e Timbro', marginL, sigY + 95, { align: 'center', width: halfW });

        // Destra — Centro Affiliato
        const sigX2 = marginL + halfW + 40;
        doc.roundedRect(sigX2, sigY, halfW, 110, 6)
           .fillAndStroke('#F5F9F5', VERDE);
        doc.font('Helvetica-Bold').fontSize(9).fillColor(VERDE)
           .text('PER IL CENTRO AFFILIATO', sigX2, sigY + 12, { align: 'center', width: halfW });
        doc.font('Helvetica').fontSize(9).fillColor(GRIGIO)
           .text(affiliate.organization_name || '___________________', sigX2, sigY + 26, { align: 'center', width: halfW });
        doc.font('Helvetica-Oblique').fontSize(8).fillColor(GRIGIO2)
           .text(affiliate.contact_name || '___________________', sigX2, sigY + 40, { align: 'center', width: halfW });
        doc.moveTo(sigX2 + 20, sigY + 90).lineTo(sigX2 + halfW - 20, sigY + 90)
           .lineWidth(1).strokeColor(VERDE).stroke();
        doc.font('Helvetica-Oblique').fontSize(8).fillColor(GRIGIO2)
           .text('Firma e Timbro', sigX2, sigY + 95, { align: 'center', width: halfW });

        doc.moveDown(0.5);
        const sigY2 = sigY + 120;
        // Seconda firma (clausole ex 1341)
        doc.font('Helvetica-Bold').fontSize(8).fillColor(GRIGIO2)
           .text('FIRMA SPECIFICA PER APPROVAZIONE CLAUSOLE EX ARTT. 1341-1342 C.C.', marginL, sigY2, { align: 'center', width: contentW });

        doc.roundedRect(marginL, sigY2 + 14, halfW, 60, 4)
           .fillAndStroke('#FAFAFA', '#DDDDDD');
        doc.moveTo(marginL + 20, sigY2 + 58).lineTo(marginL + halfW - 20, sigY2 + 58)
           .lineWidth(0.8).strokeColor('#AAAAAA').stroke();
        doc.font('Helvetica-Oblique').fontSize(7).fillColor(GRIGIO2)
           .text('Firma Concedente', marginL, sigY2 + 62, { align: 'center', width: halfW });

        doc.roundedRect(sigX2, sigY2 + 14, halfW, 60, 4)
           .fillAndStroke('#FAFAFA', '#DDDDDD');
        doc.moveTo(sigX2 + 20, sigY2 + 58).lineTo(sigX2 + halfW - 20, sigY2 + 58)
           .lineWidth(0.8).strokeColor('#AAAAAA').stroke();
        doc.font('Helvetica-Oblique').fontSize(7).fillColor(GRIGIO2)
           .text('Firma Centro Affiliato', sigX2, sigY2 + 62, { align: 'center', width: halfW });

        // Allegati
        doc.moveDown(2.5);
        doc.rect(marginL, doc.y, contentW, 1).fill('#EEEEEE');
        doc.moveDown(0.5);
        doc.font('Helvetica-Oblique').fontSize(8).fillColor(GRIGIO2)
           .text('ALLEGATI: A — Specifiche Tecniche Piattaforma  |  B — Linee Guida di Brand  |  C — Accordo GDPR (DPA)', marginL, doc.y, { align: 'center', width: contentW });

        _footer(doc, pageW, pageH, marginL, VERDE);

        doc.end();
    });
}

// ─── FUNZIONI DI STILE ─────────────────────────────────────────────

function _header(doc, pageW, verde, rosso, marginL, contentW, subtitle) {
    doc.rect(0, 0, pageW, 6).fill(verde);
    doc.rect(0, 6, pageW, 3).fill(rosso);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(verde)
       .text('SAAM 4.0 ACADEMY SCHOOL — CONTRATTO DI AFFILIAZIONE', marginL, 16, { width: contentW / 2 });
    doc.font('Helvetica').fontSize(7).fillColor('#AAAAAA')
       .text(subtitle, marginL + contentW / 2, 16, { width: contentW / 2, align: 'right' });
    doc.rect(marginL, 30, contentW, 0.5).fill('#DDDDDD');
    doc.moveDown(0.3);
}

function _footer(doc, pageW, pageH, marginL, verde) {
    const fy = pageH - 36;
    doc.rect(0, fy, pageW, 0.5).fill('#DDDDDD');
    doc.font('Helvetica').fontSize(7).fillColor('#AAAAAA')
       .text('www.angelopagliara.it — training@angelopagliara.it — angelopagliara@mypec.eu', 0, fy + 8, { align: 'center', width: pageW });
    doc.font('Helvetica-Bold').fontSize(7).fillColor(verde)
       .text(`Pag. ${doc.bufferedPageRange().count}`, pageW - 80, fy + 8);
}

function _heading1(doc, text, marginL, contentW, verde, nero) {
    const y = doc.y + 10;
    doc.rect(marginL, y, contentW, 28).fill('#F0F7F2');
    doc.rect(marginL, y, 4, 28).fill(verde);
    doc.font('Helvetica-Bold').fontSize(13).fillColor(verde)
       .text(text, marginL + 14, y + 7, { width: contentW - 20 });
    doc.moveDown(0.3);
}

function _heading2(doc, text, y, marginL, verde) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(verde)
       .text(text, marginL, doc.y + 6);
}

function _article(doc, num, title, marginL, contentW, verde, nero) {
    const y = doc.y + 6;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(verde)
       .text(`Art. ${num} — `, marginL, y, { continued: true });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(nero)
       .text(title);
    doc.rect(marginL, doc.y + 2, contentW, 0.5).fill('#DDDDDD');
    doc.moveDown(0.2);
}

function _body(doc, text, marginL, contentW, docRef, cont = false) {
    doc.font('Helvetica').fontSize(9.5).fillColor('#3A3A3A')
       .text(text, marginL, docRef.y + 3, { width: contentW, align: 'justified', lineGap: 2, continued: cont });
    if (!cont) doc.moveDown(0.3);
}

function _infoTable(doc, rows, marginL, contentW, docRef) {
    const rowH  = 20;
    const col1W = 130;
    const col2W = contentW - col1W;
    let y = docRef.y + 4;

    rows.forEach(([label, value], i) => {
        const fill = i % 2 === 0 ? '#F7FAF7' : '#FFFFFF';
        docRef.rect(marginL, y, contentW, rowH).fillAndStroke(fill, '#E0E8E0');
        docRef.font('Helvetica-Bold').fontSize(8).fillColor('#444')
             .text(label, marginL + 6, y + 6, { width: col1W - 8 });
        docRef.font('Helvetica').fontSize(8).fillColor('#222')
             .text(value, marginL + col1W + 4, y + 6, { width: col2W - 10, ellipsis: true });
        y += rowH;
    });
    docRef.y = y + 4;
}

function _planTable(doc, marginL, contentW, commRate, premium) {
    const y = doc.y + 4;
    const cols = [80, 120, 120, 160];
    const headers = ['Piano', 'Canone Mensile', `Commissione (${commRate}%)`, 'Incasso Netto Centro'];
    const plans = [
        ['Basic',    '€ 9,70',  `€ ${(9.70  * commRate/100).toFixed(2)}`, `€ ${(9.70  * commRate/100).toFixed(2)}/mese`],
        ['Advanced', '€ 16,70', `€ ${(16.70 * commRate/100).toFixed(2)}`, `€ ${(16.70 * commRate/100).toFixed(2)}/mese`],
        ['Gold',     '€ 27,70', `€ ${(27.70 * commRate/100).toFixed(2)}`, `€ ${(27.70 * commRate/100).toFixed(2)}/mese`],
    ];

    let x = marginL;
    // Header
    cols.forEach((w, i) => {
        doc.rect(x, y, w, 18).fillAndStroke('#009246', '#007A38');
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#FFFFFF')
           .text(headers[i], x + 4, y + 5, { width: w - 8, align: 'center' });
        x += w;
    });

    // Rows
    plans.forEach((row, ri) => {
        x = marginL;
        const ry = y + 18 + ri * 17;
        const fill = ri % 2 === 0 ? '#F5F9F5' : '#FFFFFF';
        row.forEach((cell, ci) => {
            doc.rect(x, ry, cols[ci], 17).fillAndStroke(fill, '#CCDDCC');
            const isBold = ci === 2 || ci === 3;
            const color  = ci === 2 || ci === 3 ? '#009246' : '#222222';
            doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor(color)
               .text(cell, x + 4, ry + 5, { width: cols[ci] - 8, align: 'center' });
            x += cols[ci];
        });
    });

    doc.y = y + 18 + plans.length * 17 + 8;
}

module.exports = { generateContractPDF };

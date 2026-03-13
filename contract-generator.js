/**
 * contract-generator.js
 * Genera il PDF del Contratto di Affiliazione pre-compilato.
 * Dipendenza: pdfkit (npm install pdfkit)
 */

const PDFDocument = require('pdfkit');
const path = require('path');
const fs   = require('fs');

const CONCEDENTE = {
    ragioneSociale: 'SAAM 4.0 Academy School',
    projectManager: 'Angelo Pagliara',
    sede:           'Via Dott. Cosimo Argentieri, 24 — 72022 Latiano (BR) — Italia',
    piva:           '02490040744',
    email:          'training@angelopagliara.it',
    pec:            'angelopagliara@mypec.eu',
    siti:           'www.angelopagliara.it — www.saam40.net',
};

const VERDE  = '#009246';
const ROSSO  = '#CE2B37';
const NERO   = '#1A1A1A';
const GRIGIO = '#4A4A4A';
const GR2    = '#7A7A7A';
const BIANCO = '#FFFFFF';
const ORO    = '#C8900A';

function today()       { return new Date().toLocaleDateString('it-IT', { day:'2-digit', month:'2-digit', year:'numeric' }); }
function yearFromNow() { const d = new Date(); d.setFullYear(d.getFullYear()+1); return d.toLocaleDateString('it-IT', { day:'2-digit', month:'2-digit', year:'numeric' }); }
function contractNum(id) { return String(id).padStart(3,'0') + ' / ' + new Date().getFullYear(); }
function isPremium(notes) { return notes && notes.toLowerCase().includes('premium'); }

function generateContractPDF(affiliate) {
    return new Promise((resolve, reject) => {

        const premium      = isPremium(affiliate.notes);
        const commRate     = affiliate.commission_rate || (premium ? 30 : 20);
        const quotaAnnuale = premium ? '\u20ac 197,00' : '\u20ac 97,00';
        const cNum         = contractNum(affiliate.id);
        const subtitle     = 'Contratto N. ' + cNum + ' \u2014 ' + affiliate.organization_name;

        const doc = new PDFDocument({
            size: 'A4',
            margins: { top: 42, bottom: 42, left: 60, right: 60 },
            autoFirstPage: false,
            bufferPages: true,
            info: {
                Title:   'Contratto Affiliazione \u2014 ' + affiliate.organization_name,
                Author:  'SAAM 4.0 Academy School',
                Subject: 'Contratto di Affiliazione',
                Creator: 'Saam 4.0 Platform',
            }
        });

        const chunks = [];
        doc.on('data',  c => chunks.push(c));
        doc.on('end',   () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const W  = 595.28;
        const H  = 841.89;
        const ML = 60;
        const CW = W - ML - 60;

        let pageNum     = 0;
        let isCoverPage = true;

        // ── Header/Footer automatici su ogni pagina (tranne copertina) ──
        doc.on('pageAdded', () => {
            pageNum++;
            if (isCoverPage) return;

            // Header
            doc.rect(0, 0, W, 5).fill(VERDE);
            doc.rect(0, 5, W, 3).fill(ROSSO);
            doc.font('Helvetica-Bold').fontSize(7.5).fillColor(VERDE)
               .text('SAAM 4.0 ACADEMY SCHOOL \u2014 CONTRATTO DI AFFILIAZIONE', ML, 13, { width: CW * 0.55 });
            doc.font('Helvetica').fontSize(7).fillColor('#AAAAAA')
               .text(subtitle, ML + CW * 0.55, 13, { width: CW * 0.45, align: 'right' });
            doc.moveTo(ML, 27).lineTo(ML + CW, 27).lineWidth(0.4).strokeColor('#DDDDDD').stroke();

            // Footer
            const FY = H - 26;
            doc.moveTo(ML, FY - 5).lineTo(ML + CW, FY - 5).lineWidth(0.4).strokeColor('#DDDDDD').stroke();
            doc.font('Helvetica').fontSize(7).fillColor('#AAAAAA')
               .text('www.angelopagliara.it \u2014 training@angelopagliara.it \u2014 angelopagliara@mypec.eu',
                     ML, FY, { width: CW - 44, align: 'left' });
            doc.font('Helvetica-Bold').fontSize(7).fillColor(VERDE)
               .text('Pag. ' + pageNum, ML + CW - 38, FY, { width: 38, align: 'right' });

            // Reimposta cursore sotto l'header
            doc.y = 36;
        });

        // ══════════════════════════════════════
        // PAG 1 — COPERTINA
        // ══════════════════════════════════════
        isCoverPage = true;
        doc.addPage();
        isCoverPage = false;

        // ── Logo aziendale in cima alla copertina ──
        const logoPath = path.join(__dirname, 'logo_contratto.png');
        let logoBottomY = 18;
        if (fs.existsSync(logoPath)) {
            // Ratio originale banner: 800x156px = 0.195
            const logoW = CW;
            const logoH = Math.round(logoW * 156 / 800);
            doc.image(logoPath, ML, 14, { width: logoW, height: logoH });
            logoBottomY = 14 + logoH + 8;
        }

        // Linea tricolore sotto il logo
        const lw3 = CW / 3;
        doc.rect(ML,       logoBottomY, lw3, 3).fill(VERDE);
        doc.rect(ML + lw3, logoBottomY, lw3, 3).fill('#EEEEEE');
        doc.rect(ML+lw3*2, logoBottomY, lw3, 3).fill(ROSSO);

        doc.font('Helvetica').fontSize(9).fillColor(GR2)
           .text('Piattaforma AI di Apprendimento della Lingua Italiana',
                 ML, logoBottomY + 10, { align: 'center', width: CW });

        doc.font('Helvetica-Bold').fontSize(24).fillColor(NERO)
           .text('CONTRATTO DI AFFILIAZIONE', ML, logoBottomY + 26, { align: 'center', width: CW });
        doc.font('Helvetica').fontSize(9.5).fillColor(GRIGIO)
           .text('Accordo di Partnership \u2014 Programma Centri Accreditati',
                 ML, logoBottomY + 54, { align: 'center', width: CW });

        const BX = ML, BY = logoBottomY + 74, BW = CW, BH = 128;
        doc.roundedRect(BX, BY, BW, BH, 8).fillAndStroke('#F0F7F2', VERDE);

        const infoX = BX + 18;
        doc.font('Helvetica-Bold').fontSize(8).fillColor(GR2)  .text('N. CONTRATTO', infoX, BY + 14);
        doc.font('Helvetica-Bold').fontSize(14).fillColor(NERO) .text(cNum,          infoX, BY + 25);
        doc.font('Helvetica-Bold').fontSize(8).fillColor(GR2)  .text('DATA STIPULA', infoX, BY + 52);
        doc.font('Helvetica').fontSize(11).fillColor(NERO)     .text(today(),         infoX, BY + 63);
        doc.font('Helvetica-Bold').fontSize(8).fillColor(GR2)  .text('DURATA',        infoX, BY + 90);
        doc.font('Helvetica').fontSize(9).fillColor(NERO)
           .text('12 mesi \u2014 dal ' + today() + ' al ' + yearFromNow(), infoX, BY + 101);

        const badgeColor = premium ? VERDE : ORO;
        const badgeFill  = premium ? '#D1F0DC' : '#FFF3CD';
        const BDX = BX + BW - 158, BDY = BY + 14, BDW = 140, BDH = 100;
        doc.roundedRect(BDX, BDY, BDW, BDH, 7).fillAndStroke(badgeFill, badgeColor);
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(GR2)
           .text('PIANO SCELTO', BDX, BDY + 10, { align: 'center', width: BDW });
        doc.font('Helvetica-Bold').fontSize(18).fillColor(badgeColor)
           .text(premium ? 'PREMIUM' : 'STANDARD', BDX, BDY + 24, { align: 'center', width: BDW });
        doc.font('Helvetica-Bold').fontSize(13).fillColor(badgeColor)
           .text(quotaAnnuale + '/anno', BDX, BDY + 50, { align: 'center', width: BDW });
        doc.font('Helvetica').fontSize(9.5).fillColor(GRIGIO)
           .text('Commissioni ' + commRate + '%', BDX, BDY + 72, { align: 'center', width: BDW });

        doc.font('Helvetica-Oblique').fontSize(7.5).fillColor('#BBBBBB')
           .text('Documento generato automaticamente dalla piattaforma \u2014 Verificare prima della firma',
                 ML, BY + BH + 12, { align: 'center', width: CW });

        // Footer copertina fisso
        doc.rect(0, H - 34, W, 34).fill('#F5F9F5');
        doc.moveTo(0, H - 34).lineTo(W, H - 34).lineWidth(0.8).strokeColor(VERDE).stroke();
        doc.font('Helvetica').fontSize(7.5).fillColor(GR2)
           .text('www.angelopagliara.it \u2014 training@angelopagliara.it \u2014 angelopagliara@mypec.eu',
                 0, H - 20, { align: 'center', width: W });

        // ══════════════════════════════════════
        // PAG 2 — PARTI CONTRAENTI
        // ══════════════════════════════════════
        doc.addPage();

        H1(doc, '1. PARTI CONTRAENTI', ML, CW);
        H2(doc, 'IL CONCEDENTE', ML);
        infoTable(doc, [
            ['Ragione Sociale', CONCEDENTE.ragioneSociale + ' (P.M.: ' + CONCEDENTE.projectManager + ')'],
            ['Sede Legale',     CONCEDENTE.sede],
            ['P.IVA / C.F.',   CONCEDENTE.piva],
            ['Email',          CONCEDENTE.email],
            ['PEC',            CONCEDENTE.pec],
            ['Siti Web',       CONCEDENTE.siti],
        ], ML, CW, doc);

        doc.moveDown(0.6);
        H2(doc, 'IL CENTRO AFFILIATO', ML);
        infoTable(doc, [
            ['Ragione Sociale',     affiliate.organization_name || '\u2014'],
            ['Forma Giuridica',     '___________________________'],
            ['Sede Legale',         (affiliate.address || '___') + ' \u2014 ' + (affiliate.city || '___')],
            ['P.IVA / C.F.',        affiliate.vat_number  || '___________________________'],
            ['Referente',           affiliate.contact_name || '\u2014'],
            ['Email Istituzionale', affiliate.email        || '\u2014'],
            ['PEC',                 affiliate.pec          || '___________________________'],
            ['Codice SDI',          affiliate.codice_sdi   || '___________________________'],
            ['Telefono',            affiliate.phone        || '___________________________'],
            ['IBAN (pagamenti)',     '___________________________'],
        ], ML, CW, doc);

        doc.moveDown(0.5);
        doc.font('Helvetica-Oblique').fontSize(9).fillColor(GR2)
           .text('Le parti come sopra identificate convengono e stipulano quanto segue.',
                 ML, doc.y, { width: CW, align: 'center' });

        // ══════════════════════════════════════
        // PAG 3 — ART. 2-6
        // ══════════════════════════════════════
        doc.addPage();

        ART(doc, 2, 'Oggetto del Contratto', ML, CW);
        BODY(doc, 'Il presente Contratto disciplina i termini e le condizioni dell\'affiliazione del Centro al Programma Partner di SAAM 4.0 Academy School, piattaforma AI di apprendimento della lingua italiana. Il Centro acquisisce il diritto non esclusivo di promuovere, distribuire e gestire l\'accesso dei propri studenti alla Piattaforma, in cambio di una commissione sulle sottoscrizioni generate tramite il proprio codice univoco.', ML, CW, doc);

        ART(doc, 3, 'Piani di Abbonamento e Struttura Commissioni', ML, CW);
        BODY(doc, 'Gli studenti iscritti tramite il Centro accedono alla Piattaforma attraverso i seguenti piani mensili:', ML, CW, doc);
        planTable(doc, ML, CW, commRate);

        ART(doc, 4, 'Quota Annuale di Adesione', ML, CW);
        BODY(doc, 'Il Centro corrisponde al Concedente una Quota Annuale di Adesione di ' + quotaAnnuale + ' (piano ' + (premium ? 'Premium' : 'Standard') + '), con commissioni al ' + commRate + '%. La quota e\u2019 dovuta al momento dell\'approvazione e successivamente con cadenza annuale entro 30 giorni dalla data anniversario. Il mancato pagamento entro 15 giorni dalla scadenza comporta la sospensione dell\'accesso alla Dashboard Partner. La quota non e\u2019 rimborsabile.', ML, CW, doc);

        ART(doc, 5, 'Codice di Affiliazione e Tracciamento', ML, CW);
        doc.font('Helvetica').fontSize(9.5).fillColor('#3A3A3A')
           .text('Al Centro viene assegnato il Codice Univoco: ', ML, doc.y + 3, { continued: true, lineGap: 2 });
        doc.font('Helvetica-Bold').fontSize(10).fillColor(VERDE)
           .text(affiliate.referral_code || 'SAAM-XXXXX');
        BODY(doc, 'Tale codice e\u2019 personale, non cedibile, accessibile dalla Dashboard Partner e utilizzabile nella pagina di registrazione pubblica tramite il parametro ?ref=CODICE.', ML, CW, doc);

        ART(doc, 6, 'Pagamento delle Provvigioni', ML, CW);
        BODY(doc, 'Le provvigioni (' + commRate + '% sul canone mensile netto per studente attivo) sono calcolate il giorno 5 del mese successivo e liquidate entro il giorno 15 mediante bonifico bancario all\'IBAN comunicato dal Centro. Non sono corrisposte provvigioni su abbonamenti in prova, oggetto di chargeback o rimborso.', ML, CW, doc);

        // ══════════════════════════════════════
        // PAG 4 — ART. 7-14
        // ══════════════════════════════════════
        doc.addPage();

        ART(doc, 7,  'Account di Prova (Trial)', ML, CW);
        BODY(doc, 'Il Centro ha diritto ad attivare 1 account di prova settimanale (durata 7 giorni, limite 30 minuti, senza commissioni), tramite la Dashboard Partner. L\'abuso sistematico di questa funzionalita\u2019 comporta la revoca del diritto.', ML, CW, doc);

        ART(doc, 8,  'Dashboard Partner', ML, CW);
        BODY(doc, 'Il Concedente mette a disposizione una Dashboard Partner con: panoramica studenti attivi, MRR e commissioni maturate, monitoraggio minuti, reportistica mensile, attivazione account di prova e proiezione ricavi. Le credenziali sono comunicate all\'approvazione.', ML, CW, doc);

        ART(doc, 9,  'Obblighi del Centro Affiliato', ML, CW);
        BODY(doc, 'Il Centro si impegna a: promuovere la Piattaforma con correttezza; non cedere il codice a terzi; non registrare studenti fittizi; comunicare tempestivamente variazioni di IBAN o dati aziendali; rispettare il GDPR; non promuovere concorrenti diretti con materiali del Concedente.', ML, CW, doc);

        ART(doc, 10, 'Obblighi del Concedente', ML, CW);
        BODY(doc, 'Il Concedente garantisce: SLA minimo 99% mensile; aggiornamenti della Piattaforma senza costi aggiuntivi; preavviso di 30 giorni per variazioni tariffarie; supporto tecnico via email entro 48 ore lavorative; trasmissione mensile del riepilogo commissioni.', ML, CW, doc);

        ART(doc, 11, 'Durata, Rinnovo e Recesso', ML, CW);
        BODY(doc, 'Il Contratto ha durata di 12 mesi (dal ' + today() + ' al ' + yearFromNow() + ') con rinnovo automatico annuale, salvo disdetta scritta con 30 giorni di preavviso. Il recesso non da\u2019 diritto al rimborso della quota residua. Il Concedente puo\u2019 risolvere immediatamente per: frode, violazione grave degli obblighi, mancato pagamento oltre 15 giorni dalla scadenza.', ML, CW, doc);

        ART(doc, 12, 'Proprieta\u2019 Intellettuale e Riservatezza', ML, CW);
        BODY(doc, 'Tutti i contenuti della Piattaforma sono di proprieta\u2019 esclusiva del Concedente. Le parti si obbligano alla riservatezza su tutte le informazioni commerciali e tecniche per tutta la durata del contratto e per i 3 anni successivi alla cessazione.', ML, CW, doc);

        ART(doc, 13, 'GDPR e Protezione dei Dati', ML, CW);
        BODY(doc, 'Il trattamento dei dati personali avviene nel rispetto del Regolamento UE 2016/679 (GDPR). Le parti sottoscriveranno, ove necessario, apposito Accordo di Responsabilita\u2019 del Trattamento (DPA) ai sensi dell\'Art. 28 GDPR.', ML, CW, doc);

        ART(doc, 14, 'Foro Competente e Legge Applicabile', ML, CW);
        BODY(doc, 'Il Contratto e\u2019 regolato dalla legge italiana. Le parti tenteranno in primo luogo una risoluzione amichevole entro 30 giorni. In mancanza di accordo, il Foro esclusivamente competente e\u2019 quello di Brindisi (BR).', ML, CW, doc);

        // ══════════════════════════════════════
        // PAG 5 — FIRME
        // ══════════════════════════════════════
        doc.addPage();

        H1(doc, 'DICHIARAZIONI FINALI E FIRME', ML, CW);

        doc.font('Helvetica').fontSize(9.5).fillColor(GRIGIO)
           .text('Le parti dichiarano di aver letto, compreso e accettato integralmente il presente Contratto. Le seguenti clausole sono specificamente approvate ai sensi degli artt. 1341 e 1342 c.c.:',
                 ML, doc.y + 6, { width: CW, align: 'justified', lineGap: 2 });
        doc.moveDown(0.4);
        ['Art. 11 \u2014 Risoluzione immediata per inadempimento del Centro',
         'Art. 12 \u2014 Riservatezza triennale post-contratto',
         'Art. 13 \u2014 Limitazione di responsabilita\u2019 del Concedente',
         'Art. 14 \u2014 Clausola di proroga della competenza del Foro (Brindisi BR)'].forEach(function(c) {
            doc.font('Helvetica').fontSize(9).fillColor(GRIGIO)
               .text('\u2022 ' + c, ML + 16, doc.y + 3, { width: CW - 16 });
        });

        doc.moveDown(0.8);
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(NERO)
           .text('Luogo: ', ML, doc.y, { continued: true });
        doc.font('Helvetica').fillColor(GRIGIO)
           .text('_______________________________     ', { continued: true });
        doc.font('Helvetica-Bold').fillColor(NERO)
           .text('Data: ', { continued: true });
        doc.font('Helvetica').fillColor(GRIGIO)
           .text(today());

        doc.moveDown(1.2);
        var sigY  = doc.y;
        var halfW = (CW - 30) / 2;
        var sigX2 = ML + halfW + 30;

        sigBlock(doc, ML,    sigY, halfW, 'PER IL CONCEDENTE',      'SAAM 4.0 Academy School',              'Angelo Pagliara \u2014 Project Manager');
        sigBlock(doc, sigX2, sigY, halfW, 'PER IL CENTRO AFFILIATO', affiliate.organization_name || '___', affiliate.contact_name || '___');

        var sig2Y = sigY + 132;
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(GR2)
           .text('FIRMA SPECIFICA PER APPROVAZIONE CLAUSOLE EX ARTT. 1341-1342 C.C.',
                 ML, sig2Y, { align: 'center', width: CW });
        sig2Block(doc, ML,    sig2Y + 12, halfW, 'Firma Concedente');
        sig2Block(doc, sigX2, sig2Y + 12, halfW, 'Firma Centro Affiliato');

        var allegY = sig2Y + 80;
        doc.moveTo(ML, allegY).lineTo(ML + CW, allegY).lineWidth(0.5).strokeColor('#EEEEEE').stroke();
        doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(GR2)
           .text('ALLEGATI: A \u2014 Specifiche Tecniche Piattaforma  |  B \u2014 Linee Guida di Brand  |  C \u2014 Accordo GDPR (DPA)',
                 ML, allegY + 6, { align: 'center', width: CW });

        doc.flushPages();
        doc.end();
    });
}

// ─── BLOCCHI FIRMA ─────────────────────────────────────────────────
function sigBlock(doc, x, y, w, role, org, referente) {
    doc.roundedRect(x, y, w, 120, 6).fillAndStroke('#F5F9F5', VERDE);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(VERDE)
       .text(role, x, y + 10, { align: 'center', width: w });
    doc.font('Helvetica').fontSize(8.5).fillColor(GRIGIO)
       .text(org, x, y + 24, { align: 'center', width: w });
    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(GR2)
       .text(referente, x, y + 37, { align: 'center', width: w });
    doc.moveTo(x + 16, y + 80).lineTo(x + w - 16, y + 80)
       .lineWidth(0.8).strokeColor(VERDE).stroke();
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(VERDE)
       .text('\u2611 Preferibilmente Firma Digitale (D.Lgs. 82/2005)', x, y + 85, { align: 'center', width: w });
    doc.font('Helvetica-Oblique').fontSize(7).fillColor(GR2)
       .text('oppure Firma Autografa e Timbro', x, y + 97, { align: 'center', width: w });
    doc.font('Helvetica-Oblique').fontSize(6.5).fillColor('#BBBBBB')
       .text('(Codice del Consumo Digitale)', x, y + 108, { align: 'center', width: w });
}

function sig2Block(doc, x, y, w, label) {
    doc.roundedRect(x, y, w, 58, 4).fillAndStroke('#FAFAFA', '#DDDDDD');
    doc.moveTo(x + 16, y + 36).lineTo(x + w - 16, y + 36)
       .lineWidth(0.6).strokeColor('#AAAAAA').stroke();
    doc.font('Helvetica-Bold').fontSize(7).fillColor(VERDE)
       .text('\u2611 Preferibilmente Firma Digitale', x, y + 40, { align: 'center', width: w });
    doc.font('Helvetica-Oblique').fontSize(6.5).fillColor(GR2)
       .text(label, x, y + 50, { align: 'center', width: w });
}

// ─── STILI ─────────────────────────────────────────────────────────
function H1(doc, text, ML, CW) {
    var y = doc.y + 4;
    doc.rect(ML, y, CW, 25).fill('#F0F7F2');
    doc.rect(ML, y, 4, 25).fill(VERDE);
    doc.font('Helvetica-Bold').fontSize(12).fillColor(VERDE)
       .text(text, ML + 12, y + 6, { width: CW - 20 });
    doc.y = y + 31;
}

function H2(doc, text, ML) {
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(VERDE)
       .text(text, ML, doc.y + 5);
    doc.moveDown(0.2);
}

function ART(doc, num, title, ML, CW) {
    var y = doc.y + 4;
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(VERDE)
       .text('Art. ' + num + ' \u2014 ', ML, y, { continued: true });
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(NERO).text(title);
    doc.moveTo(ML, doc.y + 1).lineTo(ML + CW, doc.y + 1)
       .lineWidth(0.4).strokeColor('#DDDDDD').stroke();
    doc.moveDown(0.15);
}

function BODY(doc, text, ML, CW, docRef) {
    docRef.font('Helvetica').fontSize(9.5).fillColor('#3A3A3A')
          .text(text, ML, docRef.y + 3, { width: CW, align: 'justified', lineGap: 2 });
    docRef.moveDown(0.3);
}

function infoTable(doc, rows, ML, CW, docRef) {
    var rowH = 19, col1 = 128;
    var y = docRef.y + 3;
    rows.forEach(function(r, i) {
        var fill = i % 2 === 0 ? '#F7FAF7' : '#FFFFFF';
        docRef.rect(ML, y, CW, rowH).fillAndStroke(fill, '#E0E8E0');
        docRef.font('Helvetica-Bold').fontSize(7.5).fillColor('#444')
             .text(r[0], ML + 5, y + 6, { width: col1 - 8 });
        docRef.font('Helvetica').fontSize(7.5).fillColor('#1A1A1A')
             .text(r[1], ML + col1 + 4, y + 6, { width: CW - col1 - 10, ellipsis: true });
        y += rowH;
    });
    docRef.y = y + 3;
}

function planTable(doc, ML, CW, commRate) {
    var y    = doc.y + 4;
    var cols = [70, 115, 140, 150];
    var hdrs = ['Piano', 'Canone Mensile', 'Commissione (' + commRate + '%)', 'Incasso Netto Centro'];
    var data = [
        ['Basic',    '\u20ac 9,70',  '\u20ac ' + (9.70  * commRate/100).toFixed(2), '\u20ac ' + (9.70  * commRate/100).toFixed(2) + '/mese'],
        ['Advanced', '\u20ac 16,70', '\u20ac ' + (16.70 * commRate/100).toFixed(2), '\u20ac ' + (16.70 * commRate/100).toFixed(2) + '/mese'],
        ['Gold',     '\u20ac 27,70', '\u20ac ' + (27.70 * commRate/100).toFixed(2), '\u20ac ' + (27.70 * commRate/100).toFixed(2) + '/mese'],
    ];
    var hH = 16, rH = 15, x;
    x = ML;
    cols.forEach(function(w, i) {
        doc.rect(x, y, w, hH).fillAndStroke('#007A38', '#006030');
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(BIANCO)
           .text(hdrs[i], x + 3, y + 5, { width: w - 6, align: 'center' });
        x += w;
    });
    data.forEach(function(row, ri) {
        x = ML;
        var ry   = y + hH + ri * rH;
        var fill = ri % 2 === 0 ? '#F5F9F5' : BIANCO;
        row.forEach(function(cell, ci) {
            doc.rect(x, ry, cols[ci], rH).fillAndStroke(fill, '#CCDDCC');
            var bold  = ci >= 2;
            var color = ci >= 2 ? VERDE : '#222';
            doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5).fillColor(color)
               .text(cell, x + 3, ry + 4, { width: cols[ci] - 6, align: 'center' });
            x += cols[ci];
        });
    });
    doc.y = y + hH + data.length * rH + 6;
}

module.exports = { generateContractPDF };

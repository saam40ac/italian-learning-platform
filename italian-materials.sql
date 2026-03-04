-- ============================================
-- Italian Learning Platform - Materiali di Esempio
-- Esegui in pgAdmin dopo aver creato il database
-- ============================================

-- A1 - CONVERSAZIONE
INSERT INTO materials (title, description, content, level, topic, type, is_active, created_at)
VALUES (
    'Al Bar',
    'Dialogo tipico al bar italiano con vocabolario base',
    'Dialogo tipico al bar italiano:
    
Cliente: Buongiorno! Un caffè, per favore.
Barista: Subito! Macchiato, ristretto o normale?
Cliente: Normale, grazie.
Barista: Ecco a lei. Un euro, per favore.
Cliente: Grazie! Buona giornata!
Barista: Anche a lei!

Vocabolario:
- Caffè = coffee
- Macchiato = with a drop of milk
- Ristretto = strong/short espresso
- Subito = right away
- Ecco a lei = here you go (formal)',
    'A1', 'conversation', 'text', true, NOW()
);

-- A1 - GRAMMATICA
INSERT INTO materials (title, description, content, level, topic, type, is_active, created_at)
VALUES (
    'Gli Articoli Determinativi',
    'Guida completa agli articoli determinativi italiani',
    'In italiano ci sono articoli determinativi diversi:

MASCHILE SINGOLARE:
- il (consonanti normali): il libro, il tavolo, il gatto
- lo (s+consonante, z, gn, ps, x): lo studente, lo zaino, lo psicologo
- l'' (vocali): l''amico, l''uomo

MASCHILE PLURALE:
- i (consonanti normali): i libri, i tavoli
- gli (dopo lo e l''): gli studenti, gli zaini, gli amici

FEMMINILE SINGOLARE:
- la (consonanti): la casa, la mela, la ragazza
- l'' (vocali): l''amica, l''estate

FEMMINILE PLURALE:
- le (tutte): le case, le amiche

Esempi pratici:
- il gatto → i gatti
- lo zio → gli zii
- la penna → le penne
- l''arancia → le arance',
    'A1', 'grammar', 'text', true, NOW()
);

-- A1 - CULTURA
INSERT INTO materials (title, description, content, level, topic, type, is_active, created_at)
VALUES (
    'La Cucina Italiana',
    'I piatti tipici italiani e le tradizioni culinarie regionali',
    'La cucina italiana è famosa nel mondo! Ecco i piatti più amati:

PRIMI PIATTI:
- Pasta al pomodoro (nazionale)
- Risotto alla milanese (Milano - con zafferano)
- Cacio e pepe (Roma)
- Pesto alla genovese (Genova)

SECONDI PIATTI:
- Bistecca alla fiorentina (Toscana)
- Ossobuco alla milanese (Milano)
- Saltimbocca alla romana (Roma)
- Tiramisù (Veneto - anche come dolce)

DOLCI:
- Tiramisù
- Panna cotta
- Cannoli siciliani
- Gelato artigianale

Proverbi italiani sul cibo:
- "A tavola non si invecchia" = At the table, you don''t age
- "Chi mangia solo crepa solo" = Who eats alone dies alone

Ogni regione ha le sue specialità — l''Italia è famosa per la diversità culinaria!',
    'A1', 'culture', 'text', true, NOW()
);

-- B1 - GRAMMATICA
INSERT INTO materials (title, description, content, level, topic, type, is_active, created_at)
VALUES (
    'Il Congiuntivo Presente',
    'Come e quando usare il congiuntivo presente in italiano',
    'Il congiuntivo esprime incertezza, desiderio, opinione o emozione.

QUANDO SI USA:
- Dopo verbi di opinione: pensare, credere, sperare
- Dopo verbi di emozione: essere felice, dispiacere, temere
- Dopo espressioni impersonali: è importante, è necessario
- Con "sebbene, benché, nonostante, affinché"

FORMAZIONE (verbi regolari):

PARLARE → che io parli, che tu parli, che lui/lei parli,
          che noi parliamo, che voi parliate, che loro parlino

LEGGERE → che io legga, che tu legga, che lui/lei legga,
          che noi leggiamo, che voi leggiate, che loro leggano

DORMIRE → che io dorma, che tu dorma, che lui/lei dorma,
          che noi dormiamo, che voi dormiate, che loro dormano

VERBI IRREGOLARI COMUNI:
- essere → sia, sia, sia, siamo, siate, siano
- avere → abbia, abbia, abbia, abbiamo, abbiate, abbiano
- fare → faccia, faccia, faccia, facciamo, facciate, facciano

ESEMPI:
✓ Penso che tu abbia ragione.
✓ È importante che voi studiate ogni giorno.
✓ Sebbene piova, esco lo stesso.',
    'B1', 'grammar', 'text', true, NOW()
);

-- B2 - CONVERSAZIONE
INSERT INTO materials (title, description, content, level, topic, type, is_active, created_at)
VALUES (
    'Espressioni Idiomatiche Italiane',
    'Le espressioni idiomatiche più usate nella conversazione quotidiana',
    'Espressioni idiomatiche italiane — essenziali per parlare come un madrelingua!

CORPO UMANO:
- "Avere le mani in pasta" = essere coinvolto in qualcosa
- "Perdere la testa" = innamorarsi / perdere il controllo
- "Costare un occhio della testa" = costare moltissimo
- "Non vedere l''ora" = non aspettarsi l''ora di fare qualcosa
- "Avere la testa fra le nuvole" = essere distratto

CIBO:
- "Buono come il pane" = persona molto buona
- "Non è pane per i miei denti" = non fa per me
- "Avere il prosciutto sugli occhi" = non vedere la realtà

SITUAZIONI:
- "In bocca al lupo!" → "Crepi!" = Good luck! → Thank you! (letteralmente: "in the wolf''s mouth")
- "Mamma mia!" = esclamazione di sorpresa/meraviglia
- "Dai!" = Come on! / Really?
- "Boh!" = I don''t know / who knows?

PROVERBI COMUNI:
- "Chi dorme non piglia pesci" = The early bird catches the worm
- "A caval donato non si guarda in bocca" = Don''t look a gift horse in the mouth',
    'B2', 'conversation', 'text', true, NOW()
);

-- Verifica inserimento
SELECT id, title, level, topic, created_at FROM materials ORDER BY level, topic;

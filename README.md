# Stuffed!

Gioco gestionale incrementale in prima persona, ambientato in una fabbrica di pupazzi, pensato per **CrazyGames** (HTML5, Three.js).

Dai camion scendono i pupazzi, che scappano dal giocatore. Il giocatore li stordisce con il blaster a schiuma, li afferra e li lancia nell'**Imbottitrice**. Le lattine prodotte viaggiano sul nastro fino alla spedizione e fanno guadagnare soldi. Ogni giornata ha un tempo limite e una quota da raggiungere. A fine giornata si comprano potenziamenti.

## Come funziona

Si gioca in **partita continua**, senza giornate, con salvataggio automatico. I camion consegnano pupazzi senza sosta e una **saracinesca** si apre a ogni consegna. L'obiettivo finale è guadagnare **$1.000.000**: al traguardo compare la schermata di vittoria e poi si può continuare.

- **Livello della fabbrica**: sale con i guadagni totali (soglie in `src/data/config.js`). Porta nuovi pupazzi, camion più grandi e lattine più preziose.
- **Missioni a tempo** facoltative, una alla volta, per esempio "Imbottisci 8 pupazzi in 75 s": danno soldi e a volte una pepita.
- **Terminale** fisico in fabbrica (E): negozio diviso in Potenziamenti, Macchine, Fabbrica e armi, Leggendari, Stile e Bonus.
- **Modalità costruzione** (B): si entra a mano libera. Mirando una macchina o un nastro, E lo sposta e X lo vende a metà prezzo. Con 1-9 o la rotella si prende un oggetto dalla borsa e si piazza su una griglia con anteprima verde o rossa (R ruota). Dopo ogni piazzamento torna subito l'arma in mano.
  - Base Fluffbot: il suo robot raccoglie i pupazzi storditi e li consegna.
  - Sparabot: torretta che spara ai pupazzi vicini.
  - Braccio robotico: messo vicino a un'Imbottitrice, afferra ogni pupazzo che ha a portata (sveglio, stordito o su un nastro) e lo butta nella tramoggia.
  - Esca Lecca-lecca: attira i pupazzi che vagano.
  - Imbottitrice: le lattine escono dallo scivolo nella casella da 1 m davanti. Se lì c'è un nastro lo seguono, altrimenti cadono a terra. Anche la prima Imbottitrice si sposta (B, poi E mirandola).
  - **Nastri**: si comprano a pacchi da 10 m, che finiscono nella borsa come le altre macchine. Si clicca l'inizio e la fine e il percorso a L con la curva si piazza da solo (R cambia il lato della curva). Trasportano tutto quello che ci finisce sopra (lattine, pupazzi storditi) fino all'unica **spedizione**, lo scivolo nel muro ovest con due pezzi di nastro fissi davanti. E su un nastro lo rimette nella borsa, X lo vende.
  - Scanner a raggi X: portale da mettere a cavallo di un nastro. Scansiona le lattine che ci passano sotto: quelle con una pepita prendono il coperchio d'oro e il braccio del portale le posa sulla casella laterale (pedana gialla).
  - Estrattore di pepite: accetta solo lattine (da un nastro o lanciate dentro), estrae la pepita e fa uscire la lattina dal davanti.
- **Lattine**: sono oggetti fisici. Si raccolgono con E e si lanciano con F: il lancio assistito le manda nella spedizione.
- **Pepite d'oro** nascoste in alcuni pupazzi: non si vedono mai sui pupazzi, e nelle lattine solo dopo il passaggio sotto uno Scanner. La pepita resta sigillata nella lattina e si recupera solo con l'Estrattore. Una lattina con la pepita che arriva alla spedizione viene venduta normalmente e la pepita è persa, senza alcun avviso. Le pepite servono per gli oggetti **leggendari**, che costano almeno 10 pepite: Mega Fluffbot (10), Sparabot Stellare (12), Raggio Arcobaleno (15).
- **Armi** (tasti 1-6 in fabbrica, 7-8 per le armi dell'arena): blaster, Mitragliatrice a schiuma (40 colpi rapidi tenendo premuto), Lanciareti, Cannone a coriandoli, Aspirapupazzi, Raggio Arcobaleno.
- **Annunci**: solo video facoltativi nella scheda Bonus del terminale: **+1 pepita d'oro** oppure **monete in proporzione al livello** (100 al livello 1, circa 2.700 al livello 10). Ogni tipo di video si può guardare una volta ogni 3 minuti. In fabbrica non ci sono annunci forzati; nell'Arena c'è una breve pausa pubblicitaria ogni 7 round.
- **Robot**: si muovono con un calcolo del percorso (A*) su una griglia da 0,5 m che si aggiorna quando cambia la fabbrica. Ignorano i pupazzi sopra i nastri e lasciano perdere per qualche secondo i bersagli irraggiungibili.

## Modalità Arena

Un minigioco che si avvia dalla **console arcade** nell'angolo in fondo a sinistra della fabbrica (il terminale del negozio è nell'angolo opposto) (E davanti alla console). La fabbrica viene messa da parte e si gioca su un prato aperto con l'**Imbottitrice da difendere** al centro.

- I pupazzi arrivano a **round** saltando dentro dai **4 portali**, uno per lato, e attaccano l'Imbottitrice. Quando l'Imbottitrice arriva a 0 di vita la partita finisce.
- I pupazzi colpiti fino al KO **scoppiano in una nuvola di cotone** e danno **monete dell'arena** (🪙), più un bonus a fine round.
- Si parte sempre con la **sola pistola a schiuma**. Tra un round e l'altro c'è una **pausa di 30 s** (G per iniziare subito): si spendono le monete alla **bancarella del negozio** a lato della mappa, che durante i round è chiusa.
  - Imbottitrice: kit di riparazione, corazza (+50 di vita massima, potenziabile).
  - Armi: Sparapiume (rosa di piume a corto raggio), Lanciareti, Cannone a coriandoli, Minigun, **Lanciapalloncini** (gavettoni ad area), Raggio Arcobaleno.
  - Potenziamenti della pistola e della velocità.
  - Robot e trappole, piazzati con B come in fabbrica: Sparabot, **Bonkbot** (robottino col martello che insegue i pupazzi vicini alla sua base), **Pozza di colla** (rallenta), **Trappola a molla** (rispedisce il pupazzo verso la sua porta), **Mina di coriandoli** (monouso, ad area).
- Pupazzi nuovi: **Petardo** (corre ed esplode sull'Imbottitrice; se lo colpisci prima, esplode tra i suoi amici) e **Orsone Bullo** (grosso, lento, picchia forte). Ogni tanto passa un **Orsetto d'Oro** che non attacca e vale 100 monete se lo prendi prima che scappi.
- **Boss ogni 5 round**: Re Orsetto, Regina Matrioska (si divide in Matrioske) e Cavaliere Gigante. Non si possono abbattere con un colpo solo. Ogni boss sconfitto dà **1 pepita d'oro** da spendere nella modalità classica.
- **Pausa pubblicitaria** breve ogni 7 round, all'inizio del round successivo (su Poki a ogni round, con la frequenza decisa da Poki).
- Quando si perde: un **video facoltativo** fa rigiocare il round perso con l'Imbottitrice riparata (tenendo armi, monete e difese). In alternativa si ricomincia dal round 1 o si torna in fabbrica.
- Il **record** (round più alto raggiunto) resta salvato e si vede sulla console.

Le monete, le armi e le difese valgono solo per la partita in corso; record, boss sconfitti e pepite finiscono nel salvataggio della fabbrica. Tutti i numeri (round, vita, danni, monete, prezzi) sono in `ARENA` e `ARENA_SHOP` in `src/data/config.js`.

## Sviluppo

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # output in dist/
```

## Pubblicazione su CrazyGames

1. Esegui `npm run build`.
2. Crea uno zip del **contenuto** della cartella `dist/` (con `index.html` alla radice dello zip).
3. Carica lo zip dal portale sviluppatori di CrazyGames.

L'SDK v3 di CrazyGames viene caricato a runtime da `src/systems/Platform.js` e gestisce:
`loadingStart/Stop`, `gameplayStart/Stop`, `happytime` (missione completata, vittoria), annunci `rewarded` facoltativi (nascosti se c'è un adblock), un annuncio `midgame` ogni 7 round dell'Arena e i salvataggi in cloud tramite `SDK.data`.
Fuori da CrazyGames il gioco funziona lo stesso: niente annunci e salvataggio in `localStorage`.

## Pubblicazione su Playgama

1. Esegui `npm run build:playgama` (output in `dist-playgama/`).
2. Crea uno zip del contenuto di `dist-playgama/` e caricalo su Playgama.

Questa build usa il **Playgama Bridge SDK** (caricato dal CDN `bridge.playgama.com`, che scarica solo l'adattatore del portale su cui gira) al posto dell'SDK di CrazyGames: `game_ready`, `gameplay_started/stopped`, video con premio (`showRewarded`), pubblicità tra i round dell'Arena (`showInterstitial`) e salvataggi tramite `bridge.storage` (con copia in `localStorage`). Le pause pubblicitarie vengono chieste a ogni pausa naturale (chiusura del negozio o del menu di pausa, entrata e uscita dall'Arena, inizio di ogni round dell'Arena), mai all'avvio della partita: è il Bridge a distanziarle, nessuna nei primi 90 s e poi al massimo una ogni 3 minuti; quelle troppo ravvicinate vengono saltate subito. La configurazione è in `platform/playgama/playgama-bridge-config.json` e finisce accanto a `index.html`. Gestisce anche le richieste di sistema della piattaforma: il gioco si ferma quando Playgama segnala una pausa (sovrapposizioni, scheda nascosta) e legge lo stato dell'audio all'avvio, prima di qualsiasi suono. Dove Playgama lo supporta, nel menu e nella pausa compare il pulsante **Accedi** (account del portale, `bridge.player.authorize()`): dopo l'accesso i salvataggi seguono l'account del giocatore. Il codice è in `src/systems/PlaygamaPlatform.js`.

## Pubblicazione su Poki

1. Esegui `npm run build:poki` (output in `dist-poki/`) e crea uno zip del suo contenuto.
2. Il gioco va accettato su Poki for Developers (accesso limitato): poi si carica dal loro pannello.

Questa build usa il **Poki SDK** (`game-cdn.poki.com`, l'unica richiesta esterna: font e risorse sono tutti nel pacchetto) e segue i loro requisiti:
- si entra subito nel gioco, senza menu iniziale: si parte al primo clic o tocco;
- `gameplayStart` / `gameplayStop` seguono lo stato reale del gioco (pausa, negozio, schermate di fine), mai due volte di fila e mai durante una pubblicità (vale per tutti i portali);
- `commercialBreak()` solo tornando in gioco: uscendo dal menu di pausa e all'inizio di ogni round dell'Arena (la frequenza la decide Poki);
- `rewardedBreak()` per i video con premio, con l'icona 🎬, mai verdi e con l'alternativa senza video sopra; nessun messaggio sull'ad blocker;
- salvataggi in `localStorage` protetti per la navigazione in incognito; la rotella del mouse non fa scorrere la pagina che ospita il gioco.

Il codice è in `src/systems/PokiPlatform.js`.

## Architettura

| File | Ruolo |
| --- | --- |
| `src/core/GameManager.js` | Stato (menu / gioco), consegne continue, economia, livello, terminale, salvataggi |
| `src/core/EventBus.js` | Comunicazione tra sistemi (`canSold`, `plushieStuffed`, `plushieKO`, `truckArrived`) |
| `src/data/config.js` | **Tutti i parametri di bilanciamento**: pupazzi, giornate, quota, potenziamenti, sblocchi, armi, cosmetici |
| `src/entities/Player.js` | Movimento FPS, blaster, presa, lancio con mira assistita verso la tramoggia |
| `src/entities/Plushies.js` | IA dei pupazzi (vagano, fuggono, KO, trasportati, lanciati) e relativo manager |
| `src/entities/Stuffer.js` | Coda, slot paralleli, tempo di lavorazione, blocco quando il nastro è pieno |
| `src/entities/Conveyor.js` | Nastro con lattine a distanza minima e vendita alla spedizione |
| `src/entities/Truck.js` | Consegne alla porta sul retro |
| `src/entities/Robot.js` | Fluffbot: raccoglie i pupazzi storditi e li consegna all'Imbottitrice |
| `src/entities/Viewmodel.js` | Mani, armi e pupazzi in mano in prima persona |
| `src/systems/Arena.js` | Modalità Arena: round, spawn dai portali, IA d'attacco, boss, monete, negozio, sconfitta e riprova |
| `src/world/ArenaWorld.js` | Mappa dell'arena: prato, siepi, 4 portali, ripari, bancarella del negozio |
| `src/entities/Weapons.js` | Logica delle 4 armi (colpi, rete, cono di coriandoli, aspirazione) |
| `src/world/Decor.js` | Decorazioni acquistabili della fabbrica |
| `src/systems/Tutorial.js` | Tutorial guidato (fino al terminale) |
| `src/systems/Missions.js` | Missioni a tempo |
| `src/entities/Belts.js` | Nastri a mattonelle da 1 m, percorsi a L con curva |
| `src/entities/Items.js` | Lattine come oggetti fisici, trasporto sui nastri, Incartatrice, spedizione |
| `src/systems/Nav.js` | Griglia di navigazione e calcolo dei percorsi (A*) per i robot |
| `src/systems/BuildMode.js` | Modalità costruzione: mano libera (sposta/vendi), anteprima, griglia, rotazione |
| `src/entities/Machines.js` | Macchine piazzabili (basi, torrette, catapulte, esche, linee, leggendari) |
| `src/systems/` | Input (mouse/tastiera + touch), audio procedurale, wrapper della piattaforma |
| `src/ui/UI.js` | HUD, menu, negozio, numeri fluttuanti |

La grafica (texture comprese) e i suoni sono generati via codice: non ci sono file di asset.

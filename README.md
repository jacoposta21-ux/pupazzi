# Stuffed!

Gioco gestionale incrementale in prima persona, ambientato in una fabbrica di pupazzi, pensato per **CrazyGames** (HTML5, Three.js).

Dai camion scendono i pupazzi, che scappano dal giocatore. Il giocatore li stordisce con il blaster a schiuma, li afferra e li lancia nell'**Imbottitrice**. Le lattine prodotte viaggiano sul nastro fino alla spedizione e fanno guadagnare soldi. Ogni giornata ha un tempo limite e una quota da raggiungere. A fine giornata si comprano potenziamenti.

## Come funziona

Si gioca in **partita continua**, senza giornate, con salvataggio automatico. I camion consegnano pupazzi senza sosta e una **saracinesca** si apre a ogni consegna. L'obiettivo finale è guadagnare **$1.000.000**: al traguardo compare la schermata di vittoria e poi si può continuare.

- **Livello della fabbrica**: sale con i guadagni totali (soglie in `src/data/config.js`). Porta nuovi pupazzi, camion più grandi e lattine più preziose.
- **Missioni a tempo** facoltative, una alla volta, per esempio "Imbottisci 8 pupazzi in 75 s": danno soldi e a volte una pepita.
- **Terminale** fisico in fabbrica (E): negozio diviso in Potenziamenti, Macchine, Fabbrica e armi, Leggendari, Stile e Bonus.
- **Piazzamento libero** (B): le macchine comprate finiscono nella borsa. Si piazzano su una griglia da 0,5 m con anteprima verde o rossa e si ruotano con R. Dopo ogni piazzamento torna subito l'arma in mano. In modalità costruzione, E su una macchina la riprende.
  - Base Fluffbot: il suo robot raccoglie i pupazzi storditi e li consegna.
  - Sparabot: torretta che spara ai pupazzi vicini.
  - Catapulta: lancia nella tramoggia i pupazzi storditi che finiscono sulla sua pedana.
  - Esca Lecca-lecca: attira i pupazzi che vagano.
  - Linea di produzione: Imbottitrice con nastro. Le lattine cadono in fondo al nastro.
  - Nastro: trasporta tutto quello che ci finisce sopra (lattine, pupazzi storditi). Collegando più nastri le lattine arrivano all'unica **spedizione** (lo scivolo nel muro della linea principale).
  - Scanner a raggi X: portale che scansiona i pupazzi che ci passano sotto. Quelli con una pepita si illuminano, e i robot li lasciano al giocatore.
- **Lattine**: sono oggetti fisici. Si raccolgono con E e si lanciano con F: il lancio assistito le manda nella spedizione.
- **Pepite d'oro** nascoste in alcuni pupazzi. Escono quando afferri il pupazzo a mano (non con i robot). Si trovano con lo Scanner a raggi X e si spendono per gli oggetti **leggendari**, che costano almeno 10 pepite: Mega Fluffbot (10), Sparabot Stellare (12), Raggio Arcobaleno (15).
- **Armi** (tasti 1-5): blaster, Lanciareti, Cannone a coriandoli, Aspirapupazzi, Raggio Arcobaleno.
- **Annunci**: solo video facoltativi nella scheda Bonus del terminale. Ogni video vale **1 pepita d'oro**. Non ci sono annunci forzati.

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
`loadingStart/Stop`, `gameplayStart/Stop`, `happytime` (missione completata, vittoria), annunci `rewarded` facoltativi (nascosti se c'è un adblock) e i salvataggi in cloud tramite `SDK.data`.
Fuori da CrazyGames il gioco funziona lo stesso: niente annunci e salvataggio in `localStorage`.

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
| `src/entities/Weapons.js` | Logica delle 4 armi (colpi, rete, cono di coriandoli, aspirazione) |
| `src/world/Decor.js` | Decorazioni acquistabili della fabbrica |
| `src/systems/Tutorial.js` | Tutorial guidato (fino al terminale) |
| `src/systems/Missions.js` | Missioni a tempo |
| `src/entities/Items.js` | Lattine come oggetti fisici, trasporto sui nastri, Incartatrice, spedizione |
| `src/systems/BuildMode.js` | Modalità costruzione: anteprima, griglia, rotazione, raccolta |
| `src/entities/Machines.js` | Macchine piazzabili (basi, torrette, catapulte, esche, linee, leggendari) |
| `src/systems/` | Input (mouse/tastiera + touch), audio procedurale, wrapper della piattaforma |
| `src/ui/UI.js` | HUD, menu, negozio, numeri fluttuanti |

La grafica (texture comprese) e i suoni sono generati via codice: non ci sono file di asset.

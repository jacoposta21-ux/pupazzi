# Stuffed!

Gioco gestionale incrementale in prima persona, ambientato in una fabbrica di pupazzi, pensato per **CrazyGames** (HTML5, Three.js).

Dai camion scendono i pupazzi, che scappano dal giocatore. Il giocatore li stordisce con il blaster a schiuma, li afferra e li lancia nell'**Imbottitrice**. Le lattine prodotte viaggiano sul nastro fino alla spedizione e fanno guadagnare soldi. Ogni giornata ha un tempo limite e una quota da raggiungere. A fine giornata si comprano potenziamenti.

## Contenuti

- **Tutorial guidato** il primo giorno: banner + freccia 3D; il tempo parte solo dopo il primo lancio.
- **Pupazzi**: Orsetto, Coniglietto, Gattino, Orsetto d'Oro (raro), Cagnolino Cavaliere (l'elmo assorbe i primi colpi), Orsa Matrioska (stordita si divide in 3 mini-orsetti).
- **Automazione**: i Fluffbot raccolgono da soli i pupazzi storditi e li portano all'Imbottitrice.
- **Visuale in prima persona**: mani con guanti che reggono il blaster e la pila di pupazzi, oscillazione dell'arma, rinculo, FOV dinamico in corsa, passi e atterraggio.
- **Musica** procedurale e impostazioni separate per audio, musica e qualità grafica (bassa / media / alta, con abbassamento automatico se il gioco va a scatti).
- Font Fredoka incluso nel pacchetto (nessuna richiesta esterna oltre all'SDK).

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
`loadingStart/Stop`, `gameplayStart/Stop`, `happytime` (quota raggiunta), annuncio `midgame` tra una giornata e l'altra (dal giorno 3), annuncio `rewarded` (raddoppia le lattine del giorno, nascosto se c'è un adblock) e i salvataggi in cloud tramite `SDK.data`.
Fuori da CrazyGames il gioco funziona lo stesso: niente annunci e salvataggio in `localStorage`.

## Architettura

| File | Ruolo |
| --- | --- |
| `src/core/GameManager.js` | Macchina a stati (menu, giornata, fine giornata), timer, camion, economia, salvataggi |
| `src/core/EventBus.js` | Comunicazione tra sistemi (`canSold`, `plushieStuffed`, `plushieKO`, `truckArrived`) |
| `src/data/config.js` | **Tutti i parametri di bilanciamento**: pupazzi, giornate, quota, potenziamenti, statistiche derivate |
| `src/entities/Player.js` | Movimento FPS, blaster, presa, lancio con mira assistita verso la tramoggia |
| `src/entities/Plushies.js` | IA dei pupazzi (vagano, fuggono, KO, trasportati, lanciati) e relativo manager |
| `src/entities/Stuffer.js` | Coda, slot paralleli, tempo di lavorazione, blocco quando il nastro è pieno |
| `src/entities/Conveyor.js` | Nastro con lattine a distanza minima e vendita alla spedizione |
| `src/entities/Truck.js` | Consegne alla porta sul retro |
| `src/entities/Robot.js` | Fluffbot: raccoglie i pupazzi storditi e li consegna all'Imbottitrice |
| `src/entities/Viewmodel.js` | Mani, blaster e pupazzi in mano in prima persona |
| `src/systems/Tutorial.js` | Tutorial guidato del primo giorno |
| `src/systems/` | Input (mouse/tastiera + touch), audio procedurale, wrapper della piattaforma |
| `src/ui/UI.js` | HUD, menu, negozio, numeri fluttuanti |

La grafica (texture comprese) e i suoni sono generati via codice: non ci sono file di asset.

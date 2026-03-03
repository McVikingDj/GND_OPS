document.addEventListener("DOMContentLoaded", function () {

    let strips = JSON.parse(localStorage.getItem("strips")) || [];

    function saveStrips() {
        localStorage.setItem("strips", JSON.stringify(strips));
    }

    function renderStrips() {
        document.querySelectorAll(".strip-container").forEach(c => c.innerHTML = "");

        strips.forEach(strip => {
            const div = document.createElement("div");
            div.className = "strip";
            div.dataset.id = strip.id;

            div.innerHTML = `
                <strong>${strip.callsign}</strong><br>
                ${strip.route}<br>
                ETA ${strip.eta} | ETD ${strip.etd}<br>
                ${strip.notes || ""}
            `;

            const columnContainer = document.querySelector(
                `[data-column="${strip.column}"] .strip-container`
            );

            if (columnContainer) {
                columnContainer.appendChild(div);
            }
        });

        saveStrips();
    }

    function createStrip() {
        const callsign = prompt("Callsign:");
        if (!callsign) return;

        const route = prompt("Route (BGO-GLL):");
        const eta = prompt("ETA:");
        const etd = prompt("ETD:");
        const notes = prompt("Notes:");

        strips.push({
            id: Date.now().toString(),
            callsign,
            route,
            eta,
            etd,
            notes,
            column: "inbound"
        });

        renderStrips();
    }

    document.getElementById("newStripBtn").addEventListener("click", createStrip);

    document.querySelectorAll(".strip-container").forEach(container => {
        new Sortable(container, {
            group: "shared",
            animation: 150,
            forceFallback: true,   // FIX: prevents red "not allowed" cursor
            fallbackOnBody: true,
            swapThreshold: 0.65,
            onEnd: function(evt) {
                const id = evt.item.dataset.id;
                const newColumn = evt.to.closest(".column").dataset.column;

                const strip = strips.find(s => s.id === id);
                if (strip) {
                    strip.column = newColumn;
                    saveStrips();
                }
            }
        });
    });

    renderStrips();
});

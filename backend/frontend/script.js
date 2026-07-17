// ==========================
// Live Clock
// ==========================

function updateClock() {
    const now = new Date();
    document.getElementById("clock").innerHTML =
        "Last Updated : " + now.toLocaleString();
}

setInterval(updateClock, 1000);
updateClock();


// ==========================
// Fetch Latest Data
// ==========================

async function loadLatestData() {

    try {

        const response = await fetch("http://127.0.0.1:8000/latest");

        const data = await response.json();

        document.getElementById("vr").innerHTML = data.vr + " V";
        document.getElementById("vy").innerHTML = data.vy + " V";
        document.getElementById("vb").innerHTML = data.vb + " V";

        document.getElementById("ir").innerHTML = data.ir + " A";
        document.getElementById("iy").innerHTML = data.iy + " A";

        document.getElementById("frequency").innerHTML =
            data.frequency + " Hz";

        document.getElementById("pf_r").innerHTML = data.pf_r;
        document.getElementById("pf_y").innerHTML = data.pf_y;
        document.getElementById("pf_b").innerHTML = data.pf_b;
        document.getElementById("pf_total").innerHTML = data.pf_total;

        document.getElementById("power_r").innerHTML =
            data.power_r + " kW";

        document.getElementById("power_y").innerHTML =
            data.power_y + " kW";

        document.getElementById("lastUpdate").innerHTML =
            "Live";

    }

    catch(error){

        console.log(error);

        document.getElementById("lastUpdate").innerHTML =
            "Disconnected";

    }

}

loadLatestData();

setInterval(loadLatestData,5000);


// ==========================
// Voltage Trend Graph
// ==========================

const ctx = document.getElementById("voltageChart");

const voltageChart = new Chart(ctx, {

    type: "line",

    data: {

        labels: [],

        datasets: [{

            label: "R Phase Voltage",

            data: [],

            borderColor: "#00ffff",

            backgroundColor: "rgba(0,255,255,0.15)",

            fill: true,

            tension: 0.35,

            borderWidth: 3

        }]

    },

    options: {

        responsive: true,

        maintainAspectRatio: false

    }

});

setInterval(async () => {

    try {

        const response = await fetch("http://127.0.0.1:8000/latest");

        const data = await response.json();

        console.log(data);

        let time = new Date().toLocaleTimeString();

        voltageChart.data.labels.push(time);

        voltageChart.data.datasets[0].data.push(data.vr);

        if (voltageChart.data.labels.length > 10) {

            voltageChart.data.labels.shift();

            voltageChart.data.datasets[0].data.shift();

        }

        voltageChart.update();

    }

    catch (e) {

        console.log(e);

    }

},5000);
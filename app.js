let doseData = [];
let calculatedCrCl = null;

// Load the dataset once when the page opens
fetch('data.json')
  .then(res => res.json())
  .then(data => {
    doseData = data;
    populateMedicationList();
  });

function populateMedicationList() {
  const meds = [...new Set(doseData.map(row => row.medication))].sort();
  const list = document.getElementById('medicationList');
  list.innerHTML = meds.map(m => `<option value="${m}">`).join('');
}

// Indication choices depend on which medication was typed
document.getElementById('medication').addEventListener('input', function () {
  const med = this.value.trim();
  const indications = [...new Set(
    doseData.filter(row => row.medication === med).map(row => row.indication)
  )].sort();
  document.getElementById('indicationList').innerHTML =
    indications.map(i => `<option value="${i}">`).join('');
});

function calculateCrCl() {
  const scr = parseFloat(document.getElementById('scr').value);
  const age = parseFloat(document.getElementById('age').value);
  const weight = parseFloat(document.getElementById('weight').value);
  const sex = document.getElementById('sex').value;

  const resultBox = document.getElementById('crclResult');

  if (!scr || !age || !weight) {
    resultBox.innerHTML = '<span class="error">Please fill Scr, age, and weight.</span>';
    calculatedCrCl = null;
    return;
  }

  // Cockcroft-Gault equation
  let crcl = ((140 - age) * weight) / (72 * scr);
  if (sex === 'female') crcl *= 0.85;

  calculatedCrCl = crcl;
  resultBox.innerHTML = `Calculated CrCl: <span style="color:#2563eb">${crcl.toFixed(1)} mL/min</span>`;
}

function getDose() {
  const resultBox = document.getElementById('doseResult');
  const med = document.getElementById('medication').value.trim();
  const indication = document.getElementById('indication').value.trim();

  if (calculatedCrCl === null) {
    resultBox.innerHTML = '<span class="error">Calculate CrCl first.</span>';
    return;
  }
  if (!med || !indication) {
    resultBox.innerHTML = '<span class="error">Enter both medication and indication.</span>';
    return;
  }

  const match = doseData.find(row =>
    row.medication === med &&
    row.indication === indication &&
    calculatedCrCl >= row.crcl_min &&
    calculatedCrCl <= row.crcl_max
  );

  if (!match) {
    resultBox.innerHTML = '<span class="error">No matching dose found. Check CrCl range, medication, or indication spelling.</span>';
    return;
  }

  // Flag non-numeric / manual-review doses (e.g. "Contact ID/ASP Pharmacy")
  if (isNaN(parseFloat(match.dose))) {
    resultBox.innerHTML = `<span class="warning">${match.dose}</span>`;
    return;
  }

  resultBox.innerHTML = `
    <div class="success">
      <strong>${match.dose} ${match.unite}</strong> ${match.route},
      ${match.freq_day} time(s)/day
      <br><small>CrCl range used: ${match.crcl_min}–${match.crcl_max} mL/min</small>
    </div>`;
}

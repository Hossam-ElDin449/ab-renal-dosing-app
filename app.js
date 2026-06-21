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
  const scrNow = parseFloat(document.getElementById('scr').value);
  const scrBeforeRaw = document.getElementById('scrBefore').value;
  const scrBefore = scrBeforeRaw ? parseFloat(scrBeforeRaw) : null;
  const age = parseFloat(document.getElementById('age').value);
  const weight = parseFloat(document.getElementById('weight').value);
  const heightCm = parseFloat(document.getElementById('height').value);
  const sex = document.getElementById('sex').value;

  const resultBox = document.getElementById('crclResult');

  if (!scrNow || !age || !weight || !heightCm) {
    resultBox.innerHTML = '<span class="error">Please fill Scr, age, weight, and height.</span>';
    calculatedCrCl = null;
    return;
  }

  // Step 1: choose which SCr to use (detect AKI if a 48h-ago value was given)
  let scrUsed = scrNow;
  let scrNote = '';
  if (scrBefore !== null && !isNaN(scrBefore)) {
    const rise = scrNow - scrBefore;
    if (rise > 0.3) {
      if (scrNow > scrBefore) {
        scrUsed = scrNow;
        scrNote = 'AKI detected (rise >0.3 mg/dL) — using current SCr';
      } else {
        scrUsed = (scrNow + scrBefore) / 2;
        scrNote = 'AKI detected (rise >0.3 mg/dL) — using average SCr';
      }
    }
  }

  // Step 2: choose which weight to use (BMI-based)
  const heightInches = heightCm / 2.54;
  const heightM = heightCm / 100;
  const bmi = weight / (heightM * heightM);

  // Devine formula for Ideal Body Weight; only valid for height > 60 inches (5 ft)
  let ibw = weight;
  if (heightInches > 60) {
    ibw = sex === 'female'
      ? 45.5 + 2.3 * (heightInches - 60)
      : 50 + 2.3 * (heightInches - 60);
  }

  let weightUsed = weight;
  let weightNote = `Actual body weight (BMI ${bmi.toFixed(1)})`;
  if (bmi >= 30) {
    weightUsed = ibw + 0.4 * (weight - ibw);
    weightNote = `Adjusted body weight (BMI ${bmi.toFixed(1)})`;
  }

  // Step 3: Cockcroft-Gault with chosen SCr and weight
  let crcl = ((140 - age) * weightUsed) / (72 * scrUsed);
  if (sex === 'female') crcl *= 0.85;

  calculatedCrCl = Math.round(crcl);

  resultBox.innerHTML = `
    Calculated CrCl: <span style="color:#2563eb">${calculatedCrCl} mL/min</span>
    <br><small>${scrNote ? scrNote + ' &middot; ' : ''}${weightNote}</small>
  `;
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

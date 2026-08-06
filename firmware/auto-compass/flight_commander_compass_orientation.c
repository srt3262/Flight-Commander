#include "platform.h"

#include <math.h>
#include <string.h>

#include "flight_commander_compass_orientation.h"

#define FC_COMPASS_ORIENTATION_MAX_SAMPLES 320U
#define FC_COMPASS_ORIENTATION_MIN_SAMPLES 160U
#define FC_COMPASS_ORIENTATION_MIN_SAMPLE_INTERVAL_MS 70U
#define FC_COMPASS_ORIENTATION_MIN_FACES 5U
#define FC_COMPASS_ORIENTATION_MIN_ROTATION_DEGREES 540.0f
#define FC_COMPASS_ORIENTATION_MAX_FIELD_SPREAD 0.25f
#define FC_COMPASS_ORIENTATION_MAX_RESIDUAL_DEGREES 12.0f
#define FC_COMPASS_ORIENTATION_MIN_MARGIN_DEGREES 5.0f
#define FC_COMPASS_ORIENTATION_FACE_THRESHOLD 0.72f
#define FC_COMPASS_ORIENTATION_EPSILON 1.0e-6f
#define FC_DEGREES_TO_RADIANS 0.01745329251994329577f
#define FC_RADIANS_TO_DEGREES 57.295779513082320876f

typedef struct {
    float mag[3];
    float quaternion[4];
} fcCompassOrientationSample_t;

typedef struct {
    fcCompassOrientationSample_t samples[FC_COMPASS_ORIENTATION_MAX_SAMPLES];
    uint16_t sampleCount;
    uint32_t startedAtMs;
    uint32_t lastSampleAtMs;
    uint8_t facesMask;
    float cumulativeRotationDegrees;
    float minimum[3];
    float maximum[3];
    float previousQuaternion[4];
    bool havePreviousQuaternion;
    uint8_t persistedCandidate;
    bool persistedValid;
    fcCompassOrientationStatus_t status;
} fcCompassOrientationContext_t;

static fcCompassOrientationContext_t context;

static const uint8_t permutations[6][3] = {
    { 0, 1, 2 },
    { 0, 2, 1 },
    { 1, 0, 2 },
    { 1, 2, 0 },
    { 2, 0, 1 },
    { 2, 1, 0 },
};

static const int8_t permutationParity[6] = { 1, -1, -1, 1, 1, -1 };

static float clampf(const float value, const float minimum, const float maximum)
{
    return fmaxf(minimum, fminf(maximum, value));
}

static float vectorDot(const float left[3], const float right[3])
{
    return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

static float vectorLength(const float vector[3])
{
    return sqrtf(vectorDot(vector, vector));
}

static bool vectorNormalize(float vector[3])
{
    const float magnitude = vectorLength(vector);
    if (!isfinite(magnitude) || magnitude < FC_COMPASS_ORIENTATION_EPSILON) {
        return false;
    }
    const float inverse = 1.0f / magnitude;
    vector[0] *= inverse;
    vector[1] *= inverse;
    vector[2] *= inverse;
    return true;
}

static bool quaternionNormalize(float quaternion[4])
{
    const float magnitude = sqrtf(
        quaternion[0] * quaternion[0]
        + quaternion[1] * quaternion[1]
        + quaternion[2] * quaternion[2]
        + quaternion[3] * quaternion[3]
    );
    if (!isfinite(magnitude) || magnitude < FC_COMPASS_ORIENTATION_EPSILON) {
        return false;
    }
    const float inverse = 1.0f / magnitude;
    for (unsigned axis = 0; axis < 4; axis++) {
        quaternion[axis] *= inverse;
    }
    return true;
}

static void quaternionFromEuler(
    const int16_t rollDecidegrees,
    const int16_t pitchDecidegrees,
    const int16_t yawDecidegrees,
    float quaternion[4]
)
{
    const float roll = rollDecidegrees * 0.1f * FC_DEGREES_TO_RADIANS;
    const float pitch = pitchDecidegrees * 0.1f * FC_DEGREES_TO_RADIANS;
    const float yaw = yawDecidegrees * 0.1f * FC_DEGREES_TO_RADIANS;
    const float cr = cosf(roll * 0.5f);
    const float sr = sinf(roll * 0.5f);
    const float cp = cosf(pitch * 0.5f);
    const float sp = sinf(pitch * 0.5f);
    const float cy = cosf(yaw * 0.5f);
    const float sy = sinf(yaw * 0.5f);

    // ZYX aerospace rotation, body frame to world frame.
    quaternion[0] = cr * cp * cy + sr * sp * sy;
    quaternion[1] = sr * cp * cy - cr * sp * sy;
    quaternion[2] = cr * sp * cy + sr * cp * sy;
    quaternion[3] = cr * cp * sy - sr * sp * cy;
    quaternionNormalize(quaternion);
}

static void quaternionRotate(const float quaternion[4], const float input[3], float output[3])
{
    const float tx = 2.0f * (quaternion[2] * input[2] - quaternion[3] * input[1]);
    const float ty = 2.0f * (quaternion[3] * input[0] - quaternion[1] * input[2]);
    const float tz = 2.0f * (quaternion[1] * input[1] - quaternion[2] * input[0]);

    output[0] = input[0] + quaternion[0] * tx + quaternion[2] * tz - quaternion[3] * ty;
    output[1] = input[1] + quaternion[0] * ty + quaternion[3] * tx - quaternion[1] * tz;
    output[2] = input[2] + quaternion[0] * tz + quaternion[1] * ty - quaternion[2] * tx;
}

static void quaternionInverseRotate(const float quaternion[4], const float input[3], float output[3])
{
    const float conjugate[4] = {
        quaternion[0],
        -quaternion[1],
        -quaternion[2],
        -quaternion[3],
    };
    quaternionRotate(conjugate, input, output);
}

static float quaternionRelativeAngleDegrees(const float left[4], const float right[4])
{
    const float absoluteDot = fabsf(
        left[0] * right[0]
        + left[1] * right[1]
        + left[2] * right[2]
        + left[3] * right[3]
    );
    return 2.0f * acosf(clampf(absoluteDot, -1.0f, 1.0f)) * FC_RADIANS_TO_DEGREES;
}

static uint8_t bitCount6(uint8_t value)
{
    value &= 0x3fU;
    uint8_t count = 0;
    while (value) {
        count += value & 1U;
        value >>= 1U;
    }
    return count;
}

static void updateFaceCoverage(const float quaternion[4])
{
    static const float worldGravity[3] = { 0.0f, 0.0f, 1.0f };
    float bodyGravity[3];
    quaternionInverseRotate(quaternion, worldGravity, bodyGravity);

    uint8_t dominant = 0;
    if (fabsf(bodyGravity[1]) > fabsf(bodyGravity[dominant])) {
        dominant = 1;
    }
    if (fabsf(bodyGravity[2]) > fabsf(bodyGravity[dominant])) {
        dominant = 2;
    }
    if (fabsf(bodyGravity[dominant]) < FC_COMPASS_ORIENTATION_FACE_THRESHOLD) {
        return;
    }
    const uint8_t signOffset = bodyGravity[dominant] >= 0.0f ? 0U : 1U;
    context.facesMask |= 1U << (dominant * 2U + signOffset);
}

void fcCompassOrientationMatrix(const uint8_t candidateIndex, int8_t matrix[9])
{
    memset(matrix, 0, 9U * sizeof(matrix[0]));
    uint8_t index = 0;
    for (unsigned permutation = 0; permutation < 6U; permutation++) {
        for (int8_t sx = -1; sx <= 1; sx += 2) {
            for (int8_t sy = -1; sy <= 1; sy += 2) {
                for (int8_t sz = -1; sz <= 1; sz += 2) {
                    if (permutationParity[permutation] * sx * sy * sz != 1) {
                        continue;
                    }
                    if (index == candidateIndex) {
                        const int8_t signs[3] = { sx, sy, sz };
                        for (unsigned row = 0; row < 3U; row++) {
                            matrix[row * 3U + permutations[permutation][row]] = signs[row];
                        }
                        return;
                    }
                    index++;
                }
            }
        }
    }

    // Invalid candidates are deliberately harmless. The caller separately
    // blocks heading authority when no verified mapping exists.
    matrix[0] = 1;
    matrix[4] = 1;
    matrix[8] = 1;
}

void fcCompassOrientationApply(const uint8_t candidateIndex, float vector[3])
{
    int8_t matrix[9];
    fcCompassOrientationMatrix(candidateIndex, matrix);
    const float input[3] = { vector[0], vector[1], vector[2] };
    for (unsigned row = 0; row < 3U; row++) {
        vector[row] =
            matrix[row * 3U] * input[0]
            + matrix[row * 3U + 1U] * input[1]
            + matrix[row * 3U + 2U] * input[2];
    }
}

static void reject(const fcCompassOrientationFailure_e failure)
{
    context.status.state = FC_COMPASS_ORIENTATION_REJECTED;
    context.status.failure = failure;
    context.status.candidateIndex = context.persistedValid
        ? context.persistedCandidate
        : FC_COMPASS_ORIENTATION_NONE;
}

void fcCompassOrientationInit(const uint8_t persistedCandidate, const bool persistedValid)
{
    memset(&context, 0, sizeof(context));
    context.persistedCandidate = persistedCandidate;
    context.persistedValid = persistedValid
        && persistedCandidate < FC_COMPASS_ORIENTATION_CANDIDATE_COUNT;
    context.status.state = context.persistedValid
        ? FC_COMPASS_ORIENTATION_VERIFIED
        : FC_COMPASS_ORIENTATION_REQUIRED;
    context.status.candidateIndex = context.persistedValid
        ? persistedCandidate
        : FC_COMPASS_ORIENTATION_NONE;
}

bool fcCompassOrientationStart(
    const bool accelerometerCalibrated,
    const bool gyroSettled,
    const uint32_t nowMs
)
{
    if (!accelerometerCalibrated) {
        reject(FC_COMPASS_ORIENTATION_FAILURE_ACCELEROMETER_NOT_CALIBRATED);
        return false;
    }
    if (!gyroSettled) {
        reject(FC_COMPASS_ORIENTATION_FAILURE_GYRO_NOT_SETTLED);
        return false;
    }

    context.sampleCount = 0;
    context.startedAtMs = nowMs;
    context.lastSampleAtMs = 0;
    context.facesMask = 0;
    context.cumulativeRotationDegrees = 0.0f;
    context.havePreviousQuaternion = false;
    for (unsigned axis = 0; axis < 3U; axis++) {
        context.minimum[axis] = INFINITY;
        context.maximum[axis] = -INFINITY;
    }
    context.status.state = FC_COMPASS_ORIENTATION_LEARNING;
    context.status.failure = FC_COMPASS_ORIENTATION_FAILURE_NONE;
    context.status.confidence = 0;
    context.status.facesMask = 0;
    context.status.samples = 0;
    context.status.residualCentidegrees = 0;
    context.status.marginCentidegrees = 0;
    return true;
}

void fcCompassOrientationAbort(void)
{
    if (fcCompassOrientationActive()) {
        reject(FC_COMPASS_ORIENTATION_FAILURE_ABORTED);
    }
}

bool fcCompassOrientationActive(void)
{
    return context.status.state == FC_COMPASS_ORIENTATION_LEARNING;
}

bool fcCompassOrientationValid(void)
{
    return context.persistedValid;
}

uint8_t fcCompassOrientationCandidate(void)
{
    return context.persistedValid
        ? context.persistedCandidate
        : FC_COMPASS_ORIENTATION_NONE;
}

bool fcCompassOrientationAddSample(
    const float canonicalMag[3],
    const int16_t rollDecidegrees,
    const int16_t pitchDecidegrees,
    const int16_t yawDecidegrees,
    const uint32_t nowMs
)
{
    if (!fcCompassOrientationActive()) {
        return false;
    }
    if (context.sampleCount >= FC_COMPASS_ORIENTATION_MAX_SAMPLES) {
        return false;
    }
    if (
        context.lastSampleAtMs != 0U
        && nowMs - context.lastSampleAtMs < FC_COMPASS_ORIENTATION_MIN_SAMPLE_INTERVAL_MS
    ) {
        return false;
    }

    const float magnitude = vectorLength(canonicalMag);
    if (!isfinite(magnitude) || magnitude < FC_COMPASS_ORIENTATION_EPSILON) {
        return false;
    }

    fcCompassOrientationSample_t *sample = &context.samples[context.sampleCount];
    memcpy(sample->mag, canonicalMag, sizeof(sample->mag));
    quaternionFromEuler(
        rollDecidegrees,
        pitchDecidegrees,
        yawDecidegrees,
        sample->quaternion
    );

    for (unsigned axis = 0; axis < 3U; axis++) {
        context.minimum[axis] = fminf(context.minimum[axis], sample->mag[axis]);
        context.maximum[axis] = fmaxf(context.maximum[axis], sample->mag[axis]);
    }
    updateFaceCoverage(sample->quaternion);
    if (context.havePreviousQuaternion) {
        context.cumulativeRotationDegrees += quaternionRelativeAngleDegrees(
            context.previousQuaternion,
            sample->quaternion
        );
    }
    memcpy(
        context.previousQuaternion,
        sample->quaternion,
        sizeof(context.previousQuaternion)
    );
    context.havePreviousQuaternion = true;
    context.sampleCount++;
    context.lastSampleAtMs = nowMs;
    context.status.samples = context.sampleCount;
    context.status.facesMask = context.facesMask;
    return true;
}

static bool nativeCalibration(float zero[3], float gain[3])
{
    float radius[3];
    float averageRadius = 0.0f;
    for (unsigned axis = 0; axis < 3U; axis++) {
        zero[axis] = (context.maximum[axis] + context.minimum[axis]) * 0.5f;
        radius[axis] = (context.maximum[axis] - context.minimum[axis]) * 0.5f;
        if (!isfinite(radius[axis]) || radius[axis] < FC_COMPASS_ORIENTATION_EPSILON) {
            return false;
        }
        averageRadius += radius[axis];
    }
    averageRadius /= 3.0f;
    for (unsigned axis = 0; axis < 3U; axis++) {
        gain[axis] = averageRadius / radius[axis];
    }
    return true;
}

static bool calibratedSample(
    const fcCompassOrientationSample_t *sample,
    const float zero[3],
    const float gain[3],
    float output[3]
)
{
    for (unsigned axis = 0; axis < 3U; axis++) {
        output[axis] = (sample->mag[axis] - zero[axis]) * gain[axis];
    }
    return vectorNormalize(output);
}

static float candidateResidual(
    const uint8_t candidate,
    const float zero[3],
    const float gain[3]
)
{
    float sum[3] = { 0.0f, 0.0f, 0.0f };
    uint16_t used = 0;
    for (unsigned index = 0; index < context.sampleCount; index++) {
        float body[3];
        if (!calibratedSample(&context.samples[index], zero, gain, body)) {
            continue;
        }
        fcCompassOrientationApply(candidate, body);
        float world[3];
        quaternionRotate(context.samples[index].quaternion, body, world);
        if (!vectorNormalize(world)) {
            continue;
        }
        sum[0] += world[0];
        sum[1] += world[1];
        sum[2] += world[2];
        used++;
    }
    if (used == 0U || !vectorNormalize(sum)) {
        return INFINITY;
    }

    float squared = 0.0f;
    for (unsigned index = 0; index < context.sampleCount; index++) {
        float body[3];
        if (!calibratedSample(&context.samples[index], zero, gain, body)) {
            continue;
        }
        fcCompassOrientationApply(candidate, body);
        float world[3];
        quaternionRotate(context.samples[index].quaternion, body, world);
        if (!vectorNormalize(world)) {
            continue;
        }
        const float angle = acosf(clampf(vectorDot(world, sum), -1.0f, 1.0f));
        squared += angle * angle;
    }
    return sqrtf(squared / used) * FC_RADIANS_TO_DEGREES;
}

static float calibratedFieldSpread(const float zero[3], const float gain[3])
{
    float minimum = INFINITY;
    float maximum = -INFINITY;
    float sum = 0.0f;
    uint16_t used = 0;
    for (unsigned index = 0; index < context.sampleCount; index++) {
        float calibrated[3];
        for (unsigned axis = 0; axis < 3U; axis++) {
            calibrated[axis] =
                (context.samples[index].mag[axis] - zero[axis]) * gain[axis];
        }
        const float magnitude = vectorLength(calibrated);
        if (!isfinite(magnitude) || magnitude < FC_COMPASS_ORIENTATION_EPSILON) {
            continue;
        }
        minimum = fminf(minimum, magnitude);
        maximum = fmaxf(maximum, magnitude);
        sum += magnitude;
        used++;
    }
    if (used == 0U) {
        return INFINITY;
    }
    const float mean = sum / used;
    return mean < FC_COMPASS_ORIENTATION_EPSILON
        ? INFINITY
        : (maximum - minimum) / mean;
}

static uint16_t centidegrees(const float degrees)
{
    if (!isfinite(degrees) || degrees <= 0.0f) {
        return 0U;
    }
    return (uint16_t)clampf(lrintf(degrees * 100.0f), 0.0f, 65535.0f);
}

bool fcCompassOrientationFinish(fcCompassOrientationSolution_t *solution)
{
    if (!fcCompassOrientationActive() || !solution) {
        return false;
    }
    memset(solution, 0, sizeof(*solution));

    if (context.sampleCount < FC_COMPASS_ORIENTATION_MIN_SAMPLES) {
        reject(FC_COMPASS_ORIENTATION_FAILURE_INSUFFICIENT_SAMPLES);
        return false;
    }
    if (bitCount6(context.facesMask) < FC_COMPASS_ORIENTATION_MIN_FACES) {
        reject(FC_COMPASS_ORIENTATION_FAILURE_INSUFFICIENT_POSE_COVERAGE);
        return false;
    }
    if (context.cumulativeRotationDegrees < FC_COMPASS_ORIENTATION_MIN_ROTATION_DEGREES) {
        reject(FC_COMPASS_ORIENTATION_FAILURE_INSUFFICIENT_ROTATION);
        return false;
    }
    if (!nativeCalibration(solution->nativeZero, solution->nativeGain)) {
        reject(FC_COMPASS_ORIENTATION_FAILURE_INTERNAL);
        return false;
    }
    if (
        calibratedFieldSpread(solution->nativeZero, solution->nativeGain)
        > FC_COMPASS_ORIENTATION_MAX_FIELD_SPREAD
    ) {
        reject(FC_COMPASS_ORIENTATION_FAILURE_MAGNETIC_FIELD_DISTURBED);
        return false;
    }

    uint8_t bestCandidate = FC_COMPASS_ORIENTATION_NONE;
    float bestResidual = INFINITY;
    float secondResidual = INFINITY;
    for (uint8_t candidate = 0; candidate < FC_COMPASS_ORIENTATION_CANDIDATE_COUNT; candidate++) {
        const float residual = candidateResidual(
            candidate,
            solution->nativeZero,
            solution->nativeGain
        );
        if (residual < bestResidual) {
            secondResidual = bestResidual;
            bestResidual = residual;
            bestCandidate = candidate;
        } else if (residual < secondResidual) {
            secondResidual = residual;
        }
    }

    const float margin = secondResidual - bestResidual;
    context.status.residualCentidegrees = centidegrees(bestResidual);
    context.status.marginCentidegrees = centidegrees(margin);
    if (!isfinite(bestResidual) || bestResidual > FC_COMPASS_ORIENTATION_MAX_RESIDUAL_DEGREES) {
        reject(FC_COMPASS_ORIENTATION_FAILURE_EXCESSIVE_RESIDUAL);
        return false;
    }
    if (!isfinite(margin) || margin < FC_COMPASS_ORIENTATION_MIN_MARGIN_DEGREES) {
        reject(FC_COMPASS_ORIENTATION_FAILURE_AMBIGUOUS);
        return false;
    }

    const float residualScore = clampf(
        1.0f - bestResidual / FC_COMPASS_ORIENTATION_MAX_RESIDUAL_DEGREES,
        0.0f,
        1.0f
    );
    const float marginScore = clampf(
        margin / (FC_COMPASS_ORIENTATION_MIN_MARGIN_DEGREES * 3.0f),
        0.0f,
        1.0f
    );
    const float coverageScore = clampf(
        (bitCount6(context.facesMask) - FC_COMPASS_ORIENTATION_MIN_FACES + 1.0f) / 2.0f,
        0.0f,
        1.0f
    );

    solution->accepted = true;
    solution->candidateIndex = bestCandidate;
    solution->residualCentidegrees = context.status.residualCentidegrees;
    solution->marginCentidegrees = context.status.marginCentidegrees;
    solution->confidence = (uint8_t)lrintf(100.0f * clampf(
        residualScore * 0.55f + marginScore * 0.30f + coverageScore * 0.15f,
        0.0f,
        1.0f
    ));

    context.status.state = FC_COMPASS_ORIENTATION_VERIFIED;
    context.status.failure = FC_COMPASS_ORIENTATION_FAILURE_NONE;
    context.status.candidateIndex = bestCandidate;
    context.status.confidence = solution->confidence;
    return true;
}

void fcCompassOrientationCommit(const uint8_t candidateIndex)
{
    if (candidateIndex >= FC_COMPASS_ORIENTATION_CANDIDATE_COUNT) {
        return;
    }
    context.persistedCandidate = candidateIndex;
    context.persistedValid = true;
    context.status.state = FC_COMPASS_ORIENTATION_VERIFIED;
    context.status.failure = FC_COMPASS_ORIENTATION_FAILURE_NONE;
    context.status.candidateIndex = candidateIndex;
}

const fcCompassOrientationStatus_t *fcCompassOrientationStatus(void)
{
    return &context.status;
}
